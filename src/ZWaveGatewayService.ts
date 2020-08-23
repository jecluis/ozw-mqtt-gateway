/*
 * Copyright (C) 2020  Joao Eduardo Luis <joao@wipwd.dev>
 *
 * This file is part of wip:wd's openzwave mqtt gateway (ozw-mqtt-gateway). 
 * ozw-mqtt-gateway is free software: you can redistribute it and/or modify it
 * under the terms of the EUROPEAN UNION PUBLIC LICENSE v1.2, as published by
 * the European Comission.
 */
import mqtt, { MqttClient, Packet } from "mqtt";
import fs from 'fs';
import { Logger } from "tslog";
import { EINVAL, ENOENT, EACCES } from "constants";
import { ZWaveService } from "./ZWaveService";


let logger: Logger = new Logger({name: 'zwave-config'});


export interface ZWaveConfigItem {
	device: string;
	namespace: string;
}

/**
 * Config
 * 
 * expected format:
 * 
 * 	{
 * 		"config": {
 * 			"device": "/dev/ttyACM0",
 * 			"namespace": "ozw"
 * 		}
 * 	}
 * 
 * defaults:
 * 	device: first hit from '/dev/tty{ACM,USB}*'
 *  namespace: 'ozw'
 * 
 */
export class ZWaveGatewayService {

	private static instance: ZWaveGatewayService;
	private constructor() { }

	static getInstance(mqtt?: MqttClient) {
		if (!ZWaveGatewayService.instance) {
			ZWaveGatewayService.instance = new ZWaveGatewayService();
		}
		return ZWaveGatewayService.instance;
	}

	private config: ZWaveConfigItem = {
		device: this.getCandidateDevice(),
		namespace: "ozw"
	};

	private mqtt_topic: string = "ozw-mqtt-gateway/zwave";
	private mqtt: MqttClient | undefined;

	setup(mqtt_config: {[id: string]: string}) {
		if (!('uri' in mqtt_config)) {
			throw Error("no mqtt broker URI specified");
			return;
		}

		this.mqtt = mqtt.connect(mqtt_config['uri']);
		this.mqtt.on("message", this._handleMessage.bind(this));
		this.mqtt.on("connect", () => {
			logger.info("zwave gateway service connected to mqtt broker");
			this.mqtt?.subscribe(this.mqtt_topic+"/#");
		});
	}

	teardown() {
		logger.info("disconnecting zwave gw service mqtt client");
		this.mqtt?.end();
	}


	static isConfigured(): boolean {
		let inst: ZWaveGatewayService = ZWaveGatewayService.getInstance();
		return inst.isConfigured();
	}

	static deviceExists(): boolean {
		let inst: ZWaveGatewayService = ZWaveGatewayService.getInstance();
		return inst.deviceExists();
	}

	/**
	 * Check whether we are configured. By default we will always be configured
	 * granted that there is an available device.
	 */
	isConfigured(): boolean {
		return ((this.config.device !== "") &&
				(this.config.namespace !== ""));;
	}

	deviceExists(): boolean {
		return fs.existsSync(this.config.device);
	}

	static getConfig(): ZWaveConfigItem {
		let inst: ZWaveGatewayService = ZWaveGatewayService.getInstance();
		return inst.getConfig();
	}

	getConfig(): ZWaveConfigItem {
		return this.config;
	}

	private _getAvailableDevices(): string[] {

		let candidates: string[] = [];
		let dev_contents = fs.readdirSync('/dev');
		dev_contents.forEach( (node) => {
			if (node.startsWith('ttyACM') ||
				node.startsWith('ttyUSB')) {
				let devname = node
				if (!devname.startsWith("/dev/")) {
					devname = "/dev/" + node;
				}
				candidates.push(devname);
			}
		});
		return candidates;
	}


	getDevices(): string[] {
		let available_devices: string[] = this._getAvailableDevices();
		logger.info("\navailable devices: ", available_devices);
		return available_devices;
	}

	getCandidateDevice(): string {
		let devices = this.getDevices();
		let candidate = "";
		if (devices.length > 0) {
			candidate = devices[0];
		}
		return candidate;
	}

	private _handleMessage(topic: string, payload: Buffer, packet: Packet) {
		let gwtopic: string = this.mqtt_topic;
		if (topic == gwtopic+"/config/set/request") {
			this._handleConfigSet(payload);
		} else if (topic == gwtopic+"/config/get/request") {
			this._handleConfigGet(payload);
		} else if (topic == gwtopic+"/network/start/request") {
			this._handleNetworkStart(payload);
		} else if (topic == gwtopic+"/network/stop/request") {
			this._handleNetworkStop(payload);
		} else {
			// unknown topic, drop.
			return;
		}
	}

	private reply(topic: string, data: {[id: string]: any}): void {
		let payload = JSON.stringify({payload: data});
		this.mqtt?.publish(this.mqtt_topic+"/"+topic, payload);
	}

	/**
	 * Set the zwave configuration parameters. An empty config dictionary will
	 * assume default configuration.
	 * 
	 * @param payload byte buffer containing a config payload (described below)
	 * 
	 * Payload should contain a 'nonce', and a 'config' dictionary. Contents of
	 * the 'config' dictionary are optional, which will lead to defaults being
	 * assumed. Example:
	 * 	{
	 *    "nonce": "aaaaa",
	 * 	  "config": { "device": "/dev/ttyACM0", "namespace": "ozw"}
	 *  }
	 */
	private _handleConfigSet(payload: Buffer) {
		let data = JSON.parse(payload.toString());
		if (!('nonce' in data)) {
			logger.warn("payload does not specify a nonce; drop.");
			return;
		}
		let nonce: string = data['nonce'];
		let force: boolean = false;
		if ('force' in data) {
			force = data['force'];
		}
		if (!('config' in data)) {
			// payload does not contain a config to set; complain.
			logger.warn("payload does not provide a config.")
			this.reply("config/set/result", {
				rc: -EINVAL,
				str: "config not provided",
				nonce: nonce
			});
			return;
		}
		let config = data['config'];
		let config_device = "";
		if (!('device' in config)) {
			logger.warn("provided config does not specify a device; default.");
			config_device = this.getCandidateDevice();
		} else {
			config_device = config['device'];
		}
		if (config_device === "") {
			logger.warn("no configured device; abort.");
			this.reply("config/set/result", {
				rc: -EINVAL,
				str: "device not provided or available",
				nonce: nonce
			});
			return;
		}
		if (!fs.existsSync(config_device) && !force) {
			logger.warn(`specified device '${config_device}' does not exist`);
			this.reply("config/set/result", {
				rc: -ENOENT,
				str: `device '${config_device}' does not exist`,
				nonce: nonce
			});
			return;
		}
		let config_ns = "ozw"; // default namespace
		if ('namespace' in config) {
			config_ns = config['namespace'];
		}
		if (config_ns === "" && !force) {
			logger.warn("empty namespace provided; abort.");
			this.reply("config/set/result", {
				rc: -EINVAL,
				str: "namespace cannot be empty",
				nonce: nonce
			});
			return;
		}

		this.config = {
			device: config_device,
			namespace: config_ns
		};
		this.reply("config/set/result", {
			rc: 0,
			str: "config successfully set",
			nonce: nonce
		});
	}

	/**
	 * Obtains the current config, plus a list of available devices.
	 * 
	 * @param payload byte buffer containing a nonce
	 * 
	 * Return will be in the form
	 * 	{
	 * 		"config": {
	 * 			"device": "/dev/ttyACM0",
	 * 			"namespace": "ozw",
	 * 			"available_devices": ['/dev/ttyACM0',...]
	 * 		},
	 * 		"rc": 0,
	 * 		"str": "config successfully obtained",
	 * 		"nonce": "aaaaa"
	 * 	}
	 */
	private _handleConfigGet(payload: Buffer) {
		let data = JSON.parse(payload.toString());
		if (!('nonce' in data)) {
			logger.warn("payload does not specify a nonce; drop.");
			return;
		}
		let nonce: string = data['nonce'];
		let config: {[id: string]: any} = this.config;
		// append available devices
		config['available_devices'] = this.getDevices();
		this.reply("config/get/result", {
			rc: 0,
			str: "config successfully obtained",
			nonce: nonce,
			config: config
		});
	}

	private _handleNetworkStart(payload: Buffer) {
		logger.info("handling network start request");
		let data = JSON.parse(payload.toString());
		if (!('nonce' in data)) {
			logger.warn("payload does not specify a nonce; drop.");
			return;
		}
		let nonce: string = data['nonce'];

		let retstr = "network successfully started";
		let svc: ZWaveService = ZWaveService.getInstance();
		if (svc.isDriverConnected()) {
			// network already started, this is a no-op.
			this.reply("network/start/result", {
				rc:0,
				str: retstr,
				nonce: nonce
			});
			return;
		}

		// need to start network
		let err: number = svc.startup();
		if (err == -EACCES) {
			retstr = "zwave driver not configured";
		} else if (err == -ENOENT) {
			retstr = "zwave device does not exist";
		} else if (err < 0) {
			retstr = "unknown internal error";
		}
		this.reply("network/start/result", {
			rc: err,
			str: retstr,
			nonce: nonce
		});
	}

	private _handleNetworkStop(payload: Buffer) {
		let data = JSON.parse(payload.toString());
		if (!('nonce' in data)) {
			logger.warn("payload does not specify a nonce; drop.");
			return;
		}
		let nonce: string = data['nonce'];

		let retstr = "network successfully stopped";
		let svc: ZWaveService = ZWaveService.getInstance();
		if (!svc.isDriverConnected()) {
			// network already stopped, this is a no-op.
			this.reply("network/stop/result", {
				rc: 0,
				str: retstr,
				nonce: nonce
			});
			return;
		}

		svc.shutdown();
		this.reply("network/stop/result", {
			rc: 0,
			str: retstr,
			nonce: nonce
		});
	}
}
