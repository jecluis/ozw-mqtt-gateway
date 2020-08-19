/*
 * Copyright (C) 2020  Joao Eduardo Luis <joao@wipwd.dev>
 *
 * This file is part of wip:wd's openzwave mqtt gateway (ozw-mqtt-gateway). 
 * ozw-mqtt-gateway is free software: you can redistribute it and/or modify it
 * under the terms of the EUROPEAN UNION PUBLIC LICENSE v1.2, as published by
 * the European Comission.
 */

import { Command } from "./Command";
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
		if (!this.current) {
			this.current = cmd;
			this.current.doCommand();
		} else {
			this.queue.push(cmd);
		}
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

	cancelCommand(): void {
		if (this.current) {
			this.current.cancel();
			this.current = undefined;
			this.next();
		}
	}

	handleState(state: CommandState): void {
		if (!this.current) {
			return; // ignore, we're not running a command.
		}
		if (this.current.getCmdId() != state.command) {
			return; // we are not handling this command.
		}
		this.current.handleStateChange(state);
	}
}