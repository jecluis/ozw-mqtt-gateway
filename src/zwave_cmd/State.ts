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
import { DataStore } from '../DataStore';

let logger: Logger = new Logger({name: 'get-state'});

export class GetLatestState extends Command {

	private has_finished: boolean = false;

	constructor(protected svc: ZWaveService, protected nonce: string) {
		super(svc, CommandEnum.GetLatestState, nonce);
	}

	hasFinished(): boolean {
		return this.has_finished;
	}

	getCmdName(): string {
		return "get-latest-state";
	}

	doCommand(): void {
		logger.info("getting latest state");

		let datastore = DataStore.getInstance();
		let nodes = datastore.getAll();

		//let payload = JSON.stringify(nodes);
		this.svc.publish("action/completed", {
			rc: 0,
			nodes: nodes,
			nonce: this.nonce
		});

		this.has_finished = true;
	}

}