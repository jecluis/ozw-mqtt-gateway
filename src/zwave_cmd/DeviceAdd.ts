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
import { CommandEnum } from './types';
import { ZWaveService } from '../ZWaveService';

let logger: Logger = new Logger({name: 'device-add'});

export class DeviceAddCommand extends Command {

	constructor(protected svc: ZWaveService, protected nonce: string) {
		super(svc, CommandEnum.AddDevice, nonce);
	}

	getCmdName(): string {
		return "device-add";
	}

	doCommand(): void {
		logger.info("adding node");
		this.svc.getDriver().addNode();
	}

}