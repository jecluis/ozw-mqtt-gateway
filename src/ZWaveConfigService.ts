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
import { EINVAL, ENOENT } from "constants";


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
export class ZWaveConfigService {

	private static instance: ZWaveConfigService;
	private constructor() { }

	static getInstance(mqtt?: MqttClient) {
		if (!ZWaveConfigService.instance) {
			ZWaveConfigService.instance = new ZWaveConfigService();
		}
		return ZWaveConfigService.instance;
	}

	private config: ZWaveConfigItem = {
		device: this.getCandidateDevice(),
		namespace: "ozw"
	};

	private mqtt: MqttClient | undefined;

	setup(mqtt_config: {[id: string]: string}) {
		if (!('uri' in mqtt_config)) {
			throw Error("no mqtt broker URI specified");
			return;
		}

		this.mqtt = mqtt.connect(mqtt_config['uri']);
		this.mqtt.on("message", this._handleMessage.bind(this));
		this.mqtt.on("connect", () => {
			logger.info("zwave config connected to mqtt broker");
			this.mqtt?.subscribe("ozw-mqtt-gateway/config/zwave");
		});
	}

	teardown() {
		logger.info("disconnecting zwave config mqtt client");
		this.mqtt?.end();
	}


	static isConfigured(): boolean {
		let inst: ZWaveConfigService = ZWaveConfigService.getInstance();
		return inst.isConfigured();
	}

	/**
	 * Check whether we are configured. By default we will always be configured
	 * granted that there is an available device.
	 */
	isConfigured(): boolean {
		return ((this.config.device !== "") &&
				(this.config.namespace !== "") &&
				fs.existsSync(this.config.device));
	}

	static getConfig(): ZWaveConfigItem {
		let inst: ZWaveConfigService = ZWaveConfigService.getInstance();
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
		let gwtopic: string = "ozw-mqtt-gateway/config/zwave";
		if (topic == gwtopic+"/set/request") {
			this._handleConfigSet(payload);
		} else if (topic == gwtopic+"/get/request") {
			this._handleConfigGet(payload);
		} else {
			// unknown topic, drop.
			return;
		}
	}

	private reply(topic: string, data: {[id: string]: any}): void {
		let gwtopic = "ozw-mqtt-gateway/config/zwave";
		let payload = JSON.stringify({payload: data});
		this.mqtt?.publish(gwtopic+"/"+topic, payload);
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
		if (!('config' in data)) {
			// payload does not contain a config to set; complain.
			logger.warn("payload does not provide a config.")
			this.reply("set/result", {
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
			this.reply("set/result", {
				rc: -EINVAL,
				str: "device not provided or available",
				nonce: nonce
			});
			return;
		}
		if (!fs.existsSync(config_device)) {
			logger.warn(`specified device '${config_device}' does not exist`);
			this.reply("set/result", {
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
		if (config_ns === "") {
			logger.warn("empty namespace provided; abort.");
			this.reply("set/result", {
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
		this.reply("set/result", {
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
		this.reply("get/result", {
			rc: 0,
			str: "config successfully obtained",
			nonce: nonce,
			config: config
		});
	}
}
