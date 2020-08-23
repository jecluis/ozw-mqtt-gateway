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
import { Config, TraceLogger } from './ConfigService';
import { Logger } from 'tslog';
import { EINVAL, ENOENT, ENOTSUP } from 'constants';
import { DeviceAddCommand } from './zwave_cmd/DeviceAdd';
import { DeviceRemoveCommand } from './zwave_cmd/DeviceRemove';
import { CommandQueue } from './zwave_cmd/CommandQueue';
import { Command, CancelCommand } from './zwave_cmd/Command';
import { CommandEnum, CommandState } from './zwave_cmd/types';
import { DataStore } from './DataStore';
import { GetLatestState } from './zwave_cmd/State';
import { ZWaveConfigItem, ZWaveConfigService } from './ZWaveConfigService';


let logger: Logger = new Logger({name: 'zwave'});

function info(where: string, ...args: any[]) {
	logger.info(`[${where}]`, args);
}

export class ZWaveService {

	private static instance: ZWaveService;
	constructor() {
		this.zwave = new ZWave({
			UserPath: './zwave',
			ConfigPath: './zwave/db',
			ConsoleOutput: false,
			LogFileName: 'ozw-mqtt-gateway.zwave.log'
		});
	}

	static getInstance(): ZWaveService {
		if (!ZWaveService.instance) {
			ZWaveService.instance = new ZWaveService();
		}
		return ZWaveService.instance;
	}

	private mqtt: MqttClient|undefined = undefined;
	private zwave: ZWave;
	private _config: ZWaveConfigItem = ZWaveConfigService.getConfig();
	private ns: string = ""; // mqtt namespace / topic
	private is_driver_connected: boolean = false;
	private is_driver_ready: boolean = false;
	private is_driver_failed: boolean = false;
	private command_queue: CommandQueue = CommandQueue.getInstance();
	private datastore: DataStore = DataStore.getInstance();

	private tracelogger: TraceLogger = TraceLogger.getInstance('zwavemqtt');

	setup(mqtt: MqttClient): void {
		logger.info("setting up");
		if (!!this.mqtt) {
			logger.error("trying to setup class multiple times.");
			throw Error("can't setup class multiple times");
		}
		this.mqtt = mqtt;
	}

	startup(): number {
		// attempt to connect device. We are expecting this to work, given we
		// assume the caller has done all the preparations to check whether this
		// is going to work or not.
		// In the grand scheme of things, we should probably do the checking
		// here, but we're going with the status quo for now.
		logger.info("startup...");

		// obtain the config again, because it might have changed since we
		// started up.
		if (!ZWaveConfigService.isConfigured()) {
			logger.error("zwave not configured; won't start up");
			return false;
		}
		this._config = ZWaveConfigService.getConfig();
		this.zwave.connect(this._config.device);
		this.ns = this._config.namespace;
		this._setupHandlers();
		return true;
	}

	shutdown(): void {
		logger.info("shutdown...");
		if (this.is_driver_connected) {
			this.zwave.disconnect(this._config.device);
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

	publish(who: string, what: any): void {
		let ns = this.ns + '/' + who;
		let payload = JSON.stringify({ payload: what });

		let logstr = JSON.stringify({topic: ns, payload: what});
		this.tracelogger.trace(logstr);
		this.mqtt?.publish(ns, payload);
	}

	getDriver(): ZWave {
		return this.zwave;
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
		this.zwave.on("value refreshed", this._handleValueChanged.bind(this));
		this.zwave.on("value removed", this._handleValueRemoved.bind(this));

		this.zwave.on("user alert", this._handleUserAlert.bind(this));
		this.zwave.on("manufacturer specific DB ready",
					  this._handleManufacturerDB.bind(this));
		this.zwave.on("notification", this._handleNotification.bind(this));

		this.zwave.on("scan complete", this._handleScanCompleted.bind(this));
		this.zwave.on("controller command", this._handleCommand.bind(this));

		this.mqtt?.on("message", this._handleMQTTMessage.bind(this));
		this.mqtt?.subscribe(this.ns+'/action/request');
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
		if (cmd < CommandEnum.None || cmd > CommandEnum.NotACommand) {
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

		let cmd_id = +data['command'];
		let zwave_cmd: Command | undefined = undefined;
		let nonce: string = data['nonce'];
		switch (cmd_id) {
			case CommandEnum.AddDevice:
				zwave_cmd = new DeviceAddCommand(this, nonce);
				break;
			case CommandEnum.RemoveDevice:
				zwave_cmd = new DeviceRemoveCommand(this, nonce);
				break;
			case CommandEnum.CancelCommand:
				zwave_cmd = new CancelCommand(this, nonce);
				this.command_queue.cancelCommand(nonce);
				break;
			case CommandEnum.GetLatestState:
				zwave_cmd = new GetLatestState(this, nonce);
				break;
			default:
				this.publish("action/return", {
					rc: -ENOTSUP, // not implemented
					str: "command not implemented",
					nonce: data['nonce']
				});
				return;
		}
		if (zwave_cmd) {
			this.command_queue.add(zwave_cmd);
		}
		this.publish("action/acknowledged", {
			rc: 0,
			str: "command executing",
			nonce: data['nonce']
		});
		this.command_queue.next();
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
		this.datastore.addNode(nodeId);
	}

	private _handleNodeRemove(nodeId: number) {
		info("node remove", `node ${nodeId}`);
		this.publish("node/rm", {id: nodeId});
		this.datastore.rmNode(nodeId);
	}

	private _handleNodeReady(nodeId: number, nodeInfo: NodeInfo) {
		info("node ready", `node ${nodeId}, info:`, nodeInfo);
		this.publish("node/ready", {id: nodeId, info: nodeInfo});
		this.datastore.setInfo(nodeId, nodeInfo);
		this.datastore.setReady(nodeId);
	}

	private _handleNodeNaming(nodeId: number, nodeInfo: NodeInfo) {
		info("node naming", `node ${nodeId}, info:`, nodeInfo);
		this.publish("node/naming", {id: nodeId, info: nodeInfo});
		this.datastore.setInfo(nodeId, nodeInfo);
	}

	private _handleNodeAvailable(nodeId: number, nodeInfo: NodeInfo) {
		info("node available", `node ${nodeId}, info:`, nodeInfo);
		this.publish("node/available", {id: nodeInfo, info: nodeInfo});
		this.datastore.setInfo(nodeId, nodeInfo);
		this.datastore.setAvailable(nodeId);
	}

	private _handleNodeReset(nodeId: number) {
		info("node reset", `node ${nodeId}`);
		this.publish("node/reset", {id: nodeId});
		// no clue what to do about this one
	}

	/*
	 * VALUE HANDLERS
	 */
	private _handleValueAdded(nodeId: number, cls: number, value: Value) {
		info("value add", `node ${nodeId}, cls: ${cls}, value:`, value)
		this.publish("value/add", {
			id: nodeId,
			class: cls,
			value: value
		});
		this.datastore.addValue(nodeId, cls, value);
	}

	private _handleValueChanged(nodeId: number, cls: number, value: Value) {
		info("value changed", `node: ${nodeId}, cls: ${cls}, value:`, value);
		this.publish("value/change", {
			id: nodeId,
			class: cls,
			value: value
		});
		this.datastore.setValue(nodeId, cls, value);
	}

	/*
	 * we are uncertain whether, in practice, there's a relevant difference
	 * between 'changed' and refreshed, so we are going to make them act
	 * essentially the same.
	 *
	private _handleValueRefreshed(nodeId: number, cls: number, value: Value) {
		info("value refreshed", `node: ${nodeId}, cls: ${cls}, value:`, value);
	}
	*/

	private _handleValueRemoved(nodeId: number, cls: number,
								inst: number, idx: number) {
		info("value removed", `node: ${nodeId}, cls: ${cls}, inst: ${inst} idx: ${idx}`);
		this.publish("value/remove", {
			id: nodeId,
			class: cls,
			instance: inst,
			index: idx
		});
		this.datastore.rmValue(nodeId, cls, inst, idx);
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
		let cmd_state: CommandState = {
			id: nodeId,
			state: state,
			state_str: ControllerState[state],
			notification: notification,
			message: message,
			command: command
		};
		this.publish("controller/command", cmd_state);
		this.command_queue.handleState(cmd_state);
	}
}