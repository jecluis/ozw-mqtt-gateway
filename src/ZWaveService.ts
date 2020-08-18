/*
 * Copyright (C) 2020  Joao Eduardo Luis <joao@wipwd.dev>
 *
 * This file is part of wip:wd's openzwave mqtt gateway (ozw-mqtt-gateway). 
 * ozw-mqtt-gateway is free software: you can redistribute it and/or modify it
 * under the terms of the EUROPEAN UNION PUBLIC LICENSE v1.2, as published by
 * the European Comission.
 */
import ZWave, {
	NodeInfo, Notification, Value, ControllerState, ControllerError
} from 'openzwave-shared';
import { MqttClient, Packet } from 'mqtt';
import { Config } from './ConfigService';
import { Logger } from 'tslog';
import { EINVAL, ENOENT, ENOTSUP } from 'constants';
import { DeviceAddCommand } from './zwave_cmd/DeviceAdd';
import { DeviceRemoveCommand } from './zwave_cmd/DeviceRemove';


// commands we recognize on handling.
//
enum ZWaveCommandEnum {
	None                        = 0,
	AddDevice                   = 1,
	CreateNewPrimary            = 2,
	ReceiveConfiguration        = 3,
	RemoveDevice                = 4,
	RemoveFailedNode            = 5,
	HasNodeFailed               = 6,
	ReplaceFailedNode           = 7,
	TransferPrimaryRole         = 8,
	RequestNetworkUpdate        = 9,
	RequestNodeNeighborUpdate   = 10,
	AssignReturnRoute           = 11,
	DeleteAllReturnRoutes       = 12,
	SendNodeInformation         = 13,
	ReplicationSend             = 14,
	CreateButton                = 15,
	DeleteButton                = 16,
	CancelCommand				= 17,
	NotACommand					= 18, // increase on additional commands.
}


let logger: Logger = new Logger({name: 'zwave'});

function info(where: string, ...args: any[]) {
	logger.info(`[${where}]`, args);
}

export class ZWaveService {

	private static instance: ZWaveService;
	constructor(private _mqtt: MqttClient, private _config: Config) {
		this.zwave = new ZWave({
			UserPath: './zwave',
			ConfigPath: './zwave/db',
			ConsoleOutput: false,
			LogFileName: 'ozw-mqtt-gateway.zwave.log'
		});
	}

	static getInstance(_mqtt: MqttClient, _config: Config) {
		if (!ZWaveService.instance) {
			ZWaveService.instance = new ZWaveService(_mqtt, _config);
		}
		return ZWaveService.instance;
	}

	private zwave: ZWave;
	private ns: string = ""; // mqtt namespace / topic
	private is_driver_connected: boolean = false;
	private is_driver_ready: boolean = false;
	private is_driver_failed: boolean = false;

	startup(): void {
		// attempt to connect device. We are expecting this to work, given we
		// assume the caller has done all the preparations to check whether this
		// is going to work or not.
		// In the grand scheme of things, we should probably do the checking
		// here, but we're going with the status quo for now.
		logger.info("startup...");
		this.zwave.connect(this._config.zwave.device);
		this.ns = this._config.zwave.namespace;
		this._setupHandlers();
	}

	shutdown(): void {
		logger.info("shutdown...");
		if (this.is_driver_connected) {
			this.zwave.disconnect(this._config.zwave.device);
		}
		this.is_driver_connected = false;
		this.is_driver_ready = false;
		this.is_driver_failed = false;
		this.ns = "";
	}

	isDriverConnected(): boolean {
		return this.is_driver_connected;
	}

	isDriverReady(): boolean {
		return this.is_driver_ready;
	}

	isDriverFailed(): boolean {
		return this.is_driver_failed;
	}

	private publish(who: string, what: any) {
		let ns = this.ns + '/' + who;
		let payload = JSON.stringify({ payload: what });
		this._mqtt.publish(ns, payload);
	}

	private _setupHandlers(): void {
		logger.info("setting up event handlers");
		this.zwave.on("connected", this._handleDriverConnected.bind(this));
		this.zwave.on("driver ready", this._handleDriverReady.bind(this));
		this.zwave.on("driver failed", this._handleDriverFailed.bind(this));

		this.zwave.on("node event", this._handleNodeEvent.bind(this));
		this.zwave.on("node added", this._handleNodeAdd.bind(this));
		this.zwave.on("node removed", this._handleNodeRemove.bind(this));
		this.zwave.on("node ready", this._handleNodeReady.bind(this));
		this.zwave.on("node naming", this._handleNodeNaming.bind(this));
		this.zwave.on("node reset", this._handleNodeReset.bind(this));
		this.zwave.on("node available", this._handleNodeAvailable.bind(this));

		this.zwave.on("value added", this._handleValueAdded.bind(this));
		this.zwave.on("value changed", this._handleValueChanged.bind(this));
		this.zwave.on("value refreshed", this._handleValueRefreshed.bind(this));
		this.zwave.on("value removed", this._handleValueRemoved.bind(this));

		this.zwave.on("user alert", this._handleUserAlert.bind(this));
		this.zwave.on("manufacturer specific DB ready",
					  this._handleManufacturerDB.bind(this));
		this.zwave.on("notification", this._handleNotification.bind(this));

		this.zwave.on("scan complete", this._handleScanCompleted.bind(this));
		this.zwave.on("controller command", this._handleCommand.bind(this));

		this._mqtt.on("message", this._handleMQTTMessage.bind(this));
		this._mqtt.subscribe(this.ns+'/action/request');
	}

	/*
	 * MQTT HANDLERS
	 *
	 * These shall handle the requests from our users. A request is assumed to
	 * be a command that is sent to the NS/action/request topic, with NS being
	 * our namespace. Results shall be published to the NS/action/return topic.
	 * 
	 * At the moment, there is no guarantee the commands will execute. In the
	 * future, the universe permitting, we would enjoy having an additional
	 * return, "complete", stating the request has been completed, and then
	 * rename 'return' to 'acknowledged'. For now we will stick to a dumb
	 * gateway that will pretend to know nothing about the inner-workings of the
	 * openzwave library being used.
	 */
	private wantsMQTTMessage(topic: string): boolean {
		return (topic === this.ns+'/action/request');
	}

	private _handleMQTTMessage(topic: string, payload: Buffer, packet: Packet) {
		info("mqtt handler", "received message, topic:", topic, ", payload: ", payload);
		if (!this.wantsMQTTMessage(topic)) {
			return;
		}
		let data = JSON.parse(payload.toString());
		info("mqtt handler", "data: ", data);

		if (!('nonce' in data)) {
			info("mqtt handler", "nonce not present; drop");
			// there is no way to reply to this command, drop.
			return;
		}

		if (!('command' in data)) {
			// publish error
			info("mqtt handler", "no command supplied; error");
			this.publish("action/return", {
				rc: -EINVAL,
				str: "no command supplied",
				nonce: data['nonce']
			});
			return;
		}

		let cmd: number = +data['command'];
		if (cmd < ZWaveCommandEnum.None || cmd > ZWaveCommandEnum.NotACommand) {
			info("mqtt handler", `unrecognized command '${cmd}'; error`);
			this.publish("action/return", {
				rc: -ENOENT,
				str: "unrecognized command",
				nonce: data['nonce']
			});
			return;
		}

		info("mqtt handler", `handling command '${cmd}`);
		this._handleMQTTCommand(data);
	}

	// handle command
	private _handleMQTTCommand(data: {[id: string]: string}): void {
		let logstr = "handle command request";
		info(logstr, `handling command ${data['command']}`);

		let cmd = +data['command'];
		switch (cmd) {
			case ZWaveCommandEnum.AddDevice:
				new DeviceAddCommand(this.zwave).doCommand();
				break;
			case ZWaveCommandEnum.RemoveDevice:
				new DeviceRemoveCommand(this.zwave).doCommand();
				break;
			case ZWaveCommandEnum.CancelCommand:
				this.zwave.cancelControllerCommand();
				break;
			default:
				this.publish("action/return", {
					rc: -ENOTSUP, // not implemented
					str: "command not implemented",
					nonce: data['nonce']
				});
				return;
		}
		this.publish("action/return", {
			rc: 0,
			str: "command executing",
			nonce: data['nonce']
		});
	}


	/*
	 * DRIVER HANDLERS
	 */
	private _handleDriverConnected(version: string) {
		info("driver", "connected");
		this.is_driver_connected = true;
		this.is_driver_failed = false;

		this.publish("driver", {state: "connected"});
	}

	private _handleDriverReady(homeId: number) {
		info("driver", "ready");
		this.is_driver_ready = true;
		this.is_driver_failed = false;

		this.publish("driver", {state: "ready"});
	}
	private _handleDriverFailed() {
		info("driver", "failed");
		this.is_driver_failed = true;
		this.is_driver_connected = false;
		this.is_driver_ready = false;

		this.publish("driver", {state: "failed"});
	}

	/*
	 * NODE HANDLERS
	 */
	// node catch-all
	private _handleNodeEvent(nodeId: number, data: any) {
		info("node event", `node ${nodeId}, data:`, data);
		this.publish("node/event", {data: data});
	}

	private _handleNodeAdd(nodeId: number) {
		info("node add", `node ${nodeId}`);
		this.publish("node/add", {id: nodeId});
	}

	private _handleNodeRemove(nodeId: number) {
		info("node remove", `node ${nodeId}`);
		this.publish("node/rm", {id: nodeId});
	}

	private _handleNodeReady(nodeId: number, nodeInfo: NodeInfo) {
		info("node ready", `node ${nodeId}, info:`, nodeInfo);
		this.publish("node/ready", {id: nodeId, info: nodeInfo});
	}

	private _handleNodeNaming(nodeId: number, nodeInfo: NodeInfo) {
		info("node naming", `node ${nodeId}, info:`, nodeInfo);
		this.publish("node/naming", {id: nodeId, info: nodeInfo});
	}

	private _handleNodeAvailable(nodeId: number, nodeInfo: NodeInfo) {
		info("node available", `node ${nodeId}, info:`, nodeInfo);
		this.publish("node/available", {id: nodeInfo, info: nodeInfo});
	}

	private _handleNodeReset(nodeId: number) {
		info("node reset", `node ${nodeId}`);
		this.publish("node/reset", {id: nodeId});
	}

	/*
	 * VALUE HANDLERS
	 */
	private _handleValueAdded(nodeId: number, cls: number, value: Value) {
		info("value add", `node ${nodeId}, cls: ${cls}, value:`, value)
	}

	private _handleValueChanged(nodeId: number, cls: number, value: Value) {
		info("value changed", `node: ${nodeId}, cls: ${cls}, value:`, value);
	}

	private _handleValueRefreshed(nodeId: number, cls: number, value: Value) {
		info("value refreshed", `node: ${nodeId}, cls: ${cls}, value:`, value);
	}

	private _handleValueRemoved(nodeId: number, cls: number, idx: number) {
		info("value removed", `node: ${nodeId}, cls: ${cls}, idx: ${idx}`);
	}

	/*
	 * MISC HANDLERS
	 */
	private _handleUserAlert(notification: Notification, help: string) {
		info("user alert", "notification:", notification, "help:", help);
		this.publish("alert", {notification: notification, help: help});
	}

	private _handleManufacturerDB() {
		info("db", "loaded manufacturer database");
		this.publish("db", {state: "ready"}); // ¯\_(ツ)_/¯
	}

	private _handleNotification(nodeId: number,
								notification: Notification,
								help: string) {
		info("notification", `node: ${nodeId}, notification:`, notification,
			 "help:", help);
		this.publish("notification", {
			id: nodeId,
			notification: notification,
			help: help});
	}

	private _handleScanCompleted() {
		info("controller", "scan has been completed");
		this.publish("controller/scan", {state: "complete"});
	}

	private _handleCommand(nodeId: number, state: ControllerState,
						   notification: ControllerError, message: string,
						   command: number) {
		info("command", `node: ${nodeId}, state: ${ControllerState[state]},`,
			 `notification: ${notification},`,
			 `message: ${message}, command: ${command}`);
		this.publish("command", {
			id: nodeId,
			state: state,
			state_str: ControllerState[state],
			notification: notification,
			message: message,
			command: command
		});
	}
}