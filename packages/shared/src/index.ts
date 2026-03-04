export type Message<TPayload = unknown> = {
  type: string;
  payload: TPayload;
};

export type SharedMessage<TPayload = unknown> = Message<TPayload>;

export const SHARED_PACKAGE_NAME = "@skribbl/shared";

export * from "./types.js";
export * from "./constants.js";
