/*
 * Copyright (C) 2020  Joao Eduardo Luis <joao@wipwd.dev>
 *
 * This file is part of wip:wd's openzwave mqtt gateway (ozw-mqtt-gateway). 
 * ozw-mqtt-gateway is free software: you can redistribute it and/or modify it
 * under the terms of the EUROPEAN UNION PUBLIC LICENSE v1.2, as published by
 * the European Comission.
 */
import { ControllerState } from 'openzwave-shared';
import { Logger } from 'tslog';
import { CommandState } from './types';
import { ZWaveService } from '../ZWaveService';


let logger: Logger = new Logger({name: 'command'});


export abstract class Command {

	protected state: ControllerState = ControllerState.Normal;

	constructor(
		protected svc: ZWaveService,
		protected cmd_id: number,
		protected nonce: string) { }

	abstract doCommand(): void;
	abstract getCmdName(): string;

	hasFinished(): boolean {
		switch (this.state) {
			case ControllerState.Cancel:
			case ControllerState.Completed:
			case ControllerState.Failed:
				return true;
				break;
		}
		return false;
	}

	cancel(): void {
		logger.info(`cancelling command '${this.getCmdName()}'`);
		this.svc.getDriver().cancelControllerCommand();
	}

	getCmdId(): number {
		return this.cmd_id;
	}

	handleStateChange(state: CommandState): void {
		if (state.command != this.cmd_id) {
			logger.info("dropping unknown command");
			return;
		}
		if (state.state < this.state &&
			(state.state !== ControllerState.Cancel &&
			 state.state !== ControllerState.Error)) {
			logger.error("going back in time?");
		} else if (state.state == this.state) {
			// same state, drop it.
			return;
		}
		this.state = state.state;

		let action: string = "action/";
		switch (this.state) {
			case ControllerState.InProgress:
				action += "inprogress";
				break;
			case ControllerState.Cancel:
				action += "cancelled";
				break;
			case ControllerState.Error:
				action += "error";
				break;
			case ControllerState.Starting:
				action += "starting";
				break;
			case ControllerState.Waiting:
				action += "waiting";
				break;
			case ControllerState.Failed:
				action += "failed";
				break;
			case ControllerState.Completed:
				action += "completed";
				break;
			default:
				action += "unknown";
				break;
		}

		this.svc.publish(action, {
			rc: 0,
			str: state.state,
			nonce: this.nonce
		});
	}
}