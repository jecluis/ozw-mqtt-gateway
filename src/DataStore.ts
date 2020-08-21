/*
 * Copyright (C) 2020  Joao Eduardo Luis <joao@wipwd.dev>
 *
 * This file is part of wip:wd's openzwave mqtt gateway (ozw-mqtt-gateway). 
 * ozw-mqtt-gateway is free software: you can redistribute it and/or modify it
 * under the terms of the EUROPEAN UNION PUBLIC LICENSE v1.2, as published by
 * the European Comission.
 */
import { NodeInfo, Value } from "openzwave-shared";
import { Logger } from "tslog";

let logger: Logger = new Logger({name: 'datastore'});


export interface ValueItem {
	class: number;
	value: Value;
}

export interface NodeItem {
	id: number;
	info?: NodeInfo;
	values: {[id: string]: ValueItem};

	is_available: boolean;
	is_ready: boolean;
}

export class DataStore {

	private static instance: DataStore;
	private constructor() { }

	static getInstance(): DataStore {
		if (!DataStore.instance) {
			DataStore.instance = new DataStore()
		}
		return DataStore.instance;
	}

	private nodes: {[id: number]: NodeItem} = {}

	addNode(nodeId: number): void {
		let item: NodeItem = {
			id: nodeId,
			info: undefined,
			values: {},
			is_available: false,
			is_ready: false
		};
		this.nodes[nodeId] = item;
	}

	rmNode(nodeId: number): void {
		if (nodeId in this.nodes) {
			delete this.nodes[nodeId];
		}
	}

	setInfo(nodeId: number, info: NodeInfo): void {
		if (!(nodeId in this.nodes)) {
			return;
		}
		this.nodes[nodeId].info = info;
	}

	setReady(nodeId: number): void {
		if (!(nodeId in this.nodes)) {
			return;
		}
		this.nodes[nodeId].is_ready = true;
	}

	setAvailable(nodeId: number): void {
		if (!(nodeId in this.nodes)) {
			return;
		}
		this.nodes[nodeId].is_available = true;
	}

	addValue(nodeId: number, cls: number, value: Value): void {
		if (!(nodeId in this.nodes)) {
			logger.warn(`dropping value for node id: ${nodeId}`)
			return;
		}
		let item: ValueItem = { class: cls, value: value };
		this.nodes[nodeId].values[value.value_id] = item;
	}

	setValue(nodeId: number, cls: number, value: Value): void {
		this.addValue(nodeId, cls, value);
	}

	rmValue(nodeId: number, cls: number, inst: number, idx: number): void {
		if (!(nodeId in this.nodes)) {
			return;
		}
		let value_id: string = `${nodeId}-${cls}-${inst}-${idx}`;
		if (!(value_id in this.nodes[nodeId].values)) {
			return;
		}
		delete this.nodes[nodeId].values[value_id];
	}

	getAll() {
		return Object.values(this.nodes);
	}
}