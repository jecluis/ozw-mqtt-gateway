/*
 * Copyright (C) 2020  Joao Eduardo Luis <joao@wipwd.dev>
 *
 * This file is part of wip:wd's openzwave mqtt gateway (ozw-mqtt-gateway). 
 * ozw-mqtt-gateway is free software: you can redistribute it and/or modify it
 * under the terms of the EUROPEAN UNION PUBLIC LICENSE v1.2, as published by
 * the European Comission.
 */
import mqtt, { MqttClient } from 'mqtt';
import ZWave from 'openzwave-shared';
import { ConfigService, Config } from './ConfigService';
import { Logger } from 'tslog';
import { ENOENT, EINVAL } from 'constants';
import fs from 'fs';
import { ZWaveService } from './ZWaveService';


let logger: Logger = new Logger({name: 'ozw-mqtt-gateway'});


let configSvc: ConfigService = ConfigService.getInstance();
let config: Config = configSvc.getConfig();

/* PLEASE NOTE:
 *
 * For now we are not trying to read configuration from the express REST API
 * server. Instead, we are relying solely on local configuration, at least until
 * we have a working prototype. Afterwards, when we have something that actually
 * works, we can spend time doing the polishing. And having a REST api to
 * configure things IS polishing.
 */


/*
 * Configure Z-Wave device
 *
 * In an ideal world we would be able to configure multiple zwave devices,
 * possibly even assigning them the same namespace (which is essentially the
 * mqtt topic), and pretend they are one single network. Then again, that is
 * something for our future selves to worry about :)
 * 
 */
let zwave_device: string = "";

function findDevice(): string {
	let available_devices: string[] = configSvc.getAvailableDevices();
	logger.info("\navailable devices: ", available_devices);
	if (available_devices.length == 0) {
		return "";
	}
	let device: string = available_devices[0];
	if (!device.startsWith('/dev/')) {
		device = '/dev/'+device;
	}
	return device;
}

if (!config.zwave.device) {
	// try to find a device from '/dev/'
	zwave_device = findDevice();
	if (!zwave_device) {
		logger.error("we don't have a zwave device configured; exit");
		process.exit(EINVAL);
	}
} else {
	zwave_device = config.zwave.device;
	if (!fs.existsSync(zwave_device)) {
		logger.error(`zwave device '${zwave_device}' does not exist`);
		process.exit(ENOENT);
	}
}

// ensure our config has the zwave device set. This value might have very well
// have come from the config itself, but we don't particularly care because it
// might have not.
config.zwave.device = zwave_device;

// we are only going to setup our zwave service once we got everything in place.
// There is little point in having the zwave service if we don't have an mqtt
// broker to send the events to.
let zwave: ZWaveService;

/*
 * Configure MQTT mqtt_client
 *
 * We will have only one single MQTT mqtt_client, which shall connect to a predefined
 * server. At this point in time, we will take into account our predefined
 * defaults, plus the on-disk configuration. However, much like we will allow
 * for the zwave device, these parameters can be configured via the rest API to
 * be defined later on. Configuring those parameters on-the-fly will eventually
 * mean turning off the mqtt_client, and then on again.
 */
let mqtt_server_host: string = config.mqtt.server;
let mqtt_port: number = config.mqtt.port;
let start_mqtt_client: boolean = false;
let mqtt_server_uri: string = "";
let mqtt_client: MqttClient;
let mqtt_client_ready: boolean = false;

if (mqtt_server_host && mqtt_port) {
	mqtt_server_uri = `mqtt://${mqtt_server_host}:${mqtt_port}`
	start_mqtt_client = true;
} else {
	logger.info("not starting mqtt mqtt_client: host/port not defined.");
	logger.error("mqtt not configured; exit.")
	process.exit(EINVAL);
}

// we're being simplistic here, and assuming this will simply connect. At the
// moment, we are not really trying to configure anything via REST, and we are
// quitting if we don't have the required information already. That said, we can
// safely assume we have the required configuration parameters and attempt to
// connect to the mqtt broker.
mqtt_client = mqtt.connect(mqtt_server_uri);

mqtt_client.on("connect", () => {
	logger.info(`mqtt client: connected to ${mqtt_server_uri}`);
	mqtt_client_ready = true;
	mqtt_client.publish('test', "test message");
});

mqtt_client.on("error", (error) => {
	logger.error("mqtt client: ", error);
	process.exit(1);
});


function shutdown() {
	if (zwave) {
		zwave.shutdown();
	}

	// sleep for a wee little bit to allow the zwave library to coalesce.
	// reason: we've seen quite a few crashes if we don't give it time to do its
	// thing, and, so far, we haven't gotten into debugging it. Let's be lazy.
	sleep(2000); // 2 seconds should be enough.
}

let keep_looping: boolean = true;
process.on('SIGINT', () => {
	keep_looping = false;
	shutdown();
});

function startup() {
	// setup zwave service
	zwave = ZWaveService.getInstance(mqtt_client, config);
	zwave.startup();
}


async function sleep(ms: number) {
	return new Promise( (resolve) => {
		setTimeout(resolve, ms);
	});
}

async function main() {

	console.info("waiting for mqtt client");
	while (!mqtt_client_ready) {
		await sleep(1000);
	}

	console.info("mqtt client ready, starting up...");
	startup();

	while (keep_looping) {
		console.log("set delay");
		await sleep(5000);
		console.log("slept");
	}
	console.log("stopping...");
}

main();


mqtt_client.on("message", (topic, message) => {
	console.log("from mqtt: topic = " + topic + ", message: ", message.toString());
	mqtt_client.end();
});

// http_server.listen(31337);
console.log("foo");