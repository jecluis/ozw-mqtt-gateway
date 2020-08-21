/*
 * Copyright (C) 2020  Joao Eduardo Luis <joao@wipwd.dev>
 *
 * This file is part of wip:wd's openzwave mqtt gateway (ozw-mqtt-gateway). 
 * ozw-mqtt-gateway is free software: you can redistribute it and/or modify it
 * under the terms of the EUROPEAN UNION PUBLIC LICENSE v1.2, as published by
 * the European Comission.
 */
import fs from 'fs';

interface ZWaveConfig {
	device: string;
	namespace: string;
}

interface HTTPServerConfig {
	host: string;
	port: number;
}

interface MQTTConfig {
	server: string,
	port: number
}

export interface Config {
	http_server: HTTPServerConfig;
	zwave: ZWaveConfig;
	mqtt: MQTTConfig;
}


export class ConfigService {

	private static instance: ConfigService;

	// this could, potentially, have multiple zwave devices defined.
	config: Config = {
		http_server: {
			host: "127.0.0.1",
			port: 31337
		},
		zwave: {
			device: "",
			namespace: "ozw"
		},
		mqtt: {
			server: "localhost",
			port: 1883
		}
	};

	private constructor() { }

	static getInstance(): ConfigService {
		if (!ConfigService.instance) {
			ConfigService.instance = new ConfigService();
		}
		return ConfigService.instance;
	}
 
	private _loadConfig(): boolean {
		if (!fs.existsSync('./config.json')) {
			return false;
		}
		let raw: string = fs.readFileSync('./config.json', 'utf-8');
		let loaded_config: Config = JSON.parse(raw);
		this.config = {...this.config, ...loaded_config};
		return true;
	}

	getConfig(): Config {
		return this.config;
	}

	setConfig(conf: Config): void {
		this.config = conf;
	}

	getAvailableDevices(): string[] {

		let candidates: string[] = [];
		let dev_contents = fs.readdirSync('/dev');
		dev_contents.forEach( (node) => {
			if (node.startsWith('ttyACM') ||
				node.startsWith('ttyUSB')) {
				candidates.push(node);
			}
		});
		return candidates;
	}

}

export class TraceLogger {

	private static instance: TraceLogger;

	private path: string = '.';
	private traceid: string;
	private filepath: string;

	private constructor(tracename: string) {
		this.traceid = new Date().toISOString();
		this.filepath = this.path+'/'+tracename+'-'+this.traceid+'.log';
	}

	static getInstance(tracename: string): TraceLogger {
		if (!TraceLogger.instance) {
			TraceLogger.instance = new TraceLogger(tracename);
		}
		return TraceLogger.instance;
	}

	trace(tracestr: string) {
		fs.appendFileSync(this.filepath, tracestr+'\n');
	}
}