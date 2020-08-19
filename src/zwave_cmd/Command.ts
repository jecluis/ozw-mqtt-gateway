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
import { CommandState, CommandEnum } from './types';
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

	getCmdId(): number {
		return this.cmd_id;
	}

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

	cancel(nonce?: string): void {
		logger.info(`cancelling command '${this.getCmdName()}'`);
		this.svc.getDriver().cancelControllerCommand();
		// we could try checking the sender and ensure this cancel is for our
		// operation, but we may not have a good way to do that -- the client
		// who issued the operation initially may not be the same cancelling it,
		// and we can't assume our users are stateful anyway.
		let action: string = this._getActionStateStr(ControllerState.Cancel);
		this.svc.publish(action, {
			rc: 0,
			str: "cancelled",
			nonce: (!!nonce ? nonce : "")
		});
	}

	private _getActionStateStr(s: number): string {
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
		return action;
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
		let action = this._getActionStateStr(state.state);
		this.svc.publish(action, {
			rc: 0,
			str: state.state,
			nonce: this.nonce
		});
	}
}

export class CancelCommand extends Command {

	constructor(protected svc: ZWaveService, protected nonce: string) {
		super(svc, CommandEnum.CancelCommand , nonce);
	}

	getCmdName(): string {
		return "cancel-cmd";
	}

	doCommand(): void {
		// we are not actually doing anything besides letting the user know that
		// it has been completed.
		this.svc.publish("action/completed", {
			rc: 0,
			str: "cancelled",
			nonce: this.nonce
		});
	}
}