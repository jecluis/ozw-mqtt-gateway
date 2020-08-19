/*
 * Copyright (C) 2020  Joao Eduardo Luis <joao@wipwd.dev>
 *
 * This file is part of wip:wd's openzwave mqtt gateway (ozw-mqtt-gateway). 
 * ozw-mqtt-gateway is free software: you can redistribute it and/or modify it
 * under the terms of the EUROPEAN UNION PUBLIC LICENSE v1.2, as published by
 * the European Comission.
 */
import { Logger } from 'tslog';
import { Command } from './Command';
import { CommandEnum, CommandState } from './types';
import { ZWaveService } from '../ZWaveService';


let logger: Logger = new Logger({name: 'device-rm'});


export class DeviceRemoveCommand extends Command {

	constructor(protected svc: ZWaveService, protected nonce: string) {
		super(svc, CommandEnum.RemoveDevice, nonce);
	}

	getCmdName(): string {
		return "device-remove";
	}

	doCommand(): void {
		logger.info("removing node");
		this.svc.getDriver().removeNode();
	}
}