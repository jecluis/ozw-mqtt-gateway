/*
 * Copyright (C) 2020  Joao Eduardo Luis <joao@wipwd.dev>
 *
 * This file is part of wip:wd's openzwave mqtt gateway (ozw-mqtt-gateway). 
 * ozw-mqtt-gateway is free software: you can redistribute it and/or modify it
 * under the terms of the EUROPEAN UNION PUBLIC LICENSE v1.2, as published by
 * the European Comission.
 */
import ZWave from 'openzwave-shared';
import { Logger } from 'tslog';
import { Command } from './Command';

let logger: Logger = new Logger({name: 'device-rm'});

export class DeviceRemoveCommand extends Command {

	constructor(protected zwave: ZWave) {
		super(zwave);
	}

	getCmdName(): string {
		return "device-remove";
	}

	doCommand(): void {
		logger.info("removing node");
		this.zwave.removeNode();
	}
}