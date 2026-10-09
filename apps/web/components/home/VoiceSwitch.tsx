"use client";

import { useState } from "react";

export function VoiceSwitch() {
  const [on, setOn] = useState(false);
  return (
    <div className="switch-row">
      <button
        className="switch"
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby="swLabel"
        aria-describedby="swState"
        onClick={() => setOn((v) => !v)}
      />
      <div>
        <strong id="swLabel">Lumoras Voice</strong>
        <span id="swState">{on ? "On · same customers, same calendar, same menu" : "Off · the POS runs on its own"}</span>
      </div>
    </div>
  );
}
