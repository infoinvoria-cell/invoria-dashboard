"use client";

type GlobeRotateMode = "off" | "slow" | "normal";

type Props = {
  rotateMode: GlobeRotateMode;
  loopEnabled: boolean;
  onRotateModeChange: (next: GlobeRotateMode) => void;
  onLoopToggle: () => void;
};

export default function GlobeMotionControls({ rotateMode, loopEnabled, onRotateModeChange, onLoopToggle }: Props) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      <button type="button" onClick={() => onRotateModeChange("off")} className={`ivq-glass-btn ${rotateMode === "off" ? "is-active" : ""}`}>
        <span className="ivq-glass-btn-dot" />
        Stopp
      </button>
      <button type="button" onClick={() => onRotateModeChange("slow")} className={`ivq-glass-btn ${rotateMode === "slow" ? "is-active" : ""}`}>
        <span className="ivq-glass-btn-dot" />
        Langsam
      </button>
      <button type="button" onClick={() => onRotateModeChange("normal")} className={`ivq-glass-btn ${rotateMode === "normal" ? "is-active" : ""}`}>
        <span className="ivq-glass-btn-dot" />
        Normal
      </button>
      <button type="button" onClick={onLoopToggle} className={`ivq-glass-btn ${loopEnabled ? "is-active" : ""}`}>
        <span className="ivq-glass-btn-dot" />
        Loop
      </button>
    </div>
  );
}