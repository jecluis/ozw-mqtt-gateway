/*
 * Copyright (C) 2020  Joao Eduardo Luis <joao@wipwd.dev>
 *
 * This file is part of wip:wd's openzwave mqtt gateway (ozw-mqtt-gateway). 
 * ozw-mqtt-gateway is free software: you can redistribute it and/or modify it
 * under the terms of the EUROPEAN UNION PUBLIC LICENSE v1.2, as published by
 * the European Comission.
 */

import { Command, CancelCommand } from "./Command";
import { CommandState } from "./types";
import { Logger } from 'tslog';

let logger: Logger = new Logger({name: 'cmd-queue'});


export class CommandQueue {
	private static instance: CommandQueue;

	private constructor() { }
	static getInstance() {
		if (!CommandQueue.instance) {
			CommandQueue.instance = new CommandQueue();
		}
		return CommandQueue.instance;
	}

	private queue: Command[] = [];
	private current: Command | undefined = undefined;


	add(cmd: Command): void {
		logger.info(`adding command (id '${cmd.getCmdId()}') to queue`);
		// if (!this.current) {
		// 	this.current = cmd;
		// 	this.current.doCommand();
		// } else {
		this.queue.push(cmd);
		// }
		logger.info(`queue length: ${this.queue.length}`);
	}

	reset(): void {
		this.queue = [];
		this.current = undefined;
	}

	isEmpty(): boolean {
		return (this.queue.length === 0 && this.current === null);
	}

	next(): void {
		if (this.current) {
			if (!this.current.hasFinished() || this.queue.length == 0) {
				return;
			}
			this.current = undefined;
		}
		if (this.queue.length == 0) {
			return;
		}
		logger.info(`running next command; queue length: ${this.queue.length}`);
		this.current = this.queue.shift();
		this.current?.doCommand(); // this will never be undefined, but :shrug:
	}

	cancelCommand(nonce?: string): void {
		if (this.current) {
			this.current.cancel(nonce);
		}
	}

	/* There is a very big problem with this function: it assumes there's only
	 * one single command running at any point in time. However, we may have
	 * more commands running, at different stages. A perfect example of that is
	 * cancelling a command -- there is an on-going command, and yet we are
	 * issuing a cancel command, and there will be state to handle from both.
	 * 
	 * However, we do end up serializing all requests in the queue, and cancel
	 * is a special case handled in a different manner. But it still stands that
	 * this function sucks. Also, it's ugly.
	 */
	handleState(state: CommandState): void {
		if (this.current && this.current.getCmdId() != state.command) {
			return; // we are not handling this command.
		} else if (!this.current) {
			if (this.queue.length > 0) {
				this.next();
			}
			return;
		}
		this.current.handleStateChange(state);
		if (this.current.hasFinished()) {
			this.next();
		}
	}
}