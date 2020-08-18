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


let logger: Logger = new Logger({name: 'command'});


export abstract class Command {

	constructor(protected zwave: ZWave) { }

	abstract doCommand(): void;
	abstract getCmdName(): string;

	cancel(): void {
		logger.info(`cancelling command '${this.getCmdName()}'`);
		this.zwave.cancelControllerCommand();
	}
}