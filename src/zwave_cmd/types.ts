/*
 * Copyright (C) 2020  Joao Eduardo Luis <joao@wipwd.dev>
 *
 * This file is part of wip:wd's openzwave mqtt gateway (ozw-mqtt-gateway). 
 * ozw-mqtt-gateway is free software: you can redistribute it and/or modify it
 * under the terms of the EUROPEAN UNION PUBLIC LICENSE v1.2, as published by
 * the European Comission.
 */

import { ControllerState, ControllerError } from "openzwave-shared";

// commands we recognize on handling.
//
export enum CommandEnum {
	None                        = 0,
	AddDevice                   = 1,
	CreateNewPrimary            = 2,
	ReceiveConfiguration        = 3,
	RemoveDevice                = 4,
	RemoveFailedNode            = 5,
	HasNodeFailed               = 6,
	ReplaceFailedNode           = 7,
	TransferPrimaryRole         = 8,
	RequestNetworkUpdate        = 9,
	RequestNodeNeighborUpdate   = 10,
	AssignReturnRoute           = 11,
	DeleteAllReturnRoutes       = 12,
	SendNodeInformation         = 13,
	ReplicationSend             = 14,
	CreateButton                = 15,
	DeleteButton                = 16,
	CancelCommand				= 17,
	NotACommand					= 18, // increase on additional commands.
}

export interface CommandState {
	id: number;
	state: ControllerState;
	state_str: string;
	notification: ControllerError;
	message: string;
	command: number;
}