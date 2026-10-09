/** Result of a server action, shared by server actions and the client forms that show it. */
export type ActionState = {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Changes on every result so forms can react to repeated submits. */
  at?: number;
  data?: Record<string, unknown>;
};

export const idle: ActionState = { ok: false };
