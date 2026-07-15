import React, { useMemo } from 'react';
import type { ReplayFactDto, ReplayProjection } from '@pi-ide/ipc-contracts';
import { Ic } from '../home-icons.js';
import type { ReplayController } from './replay-controller.js';
import { KIND_ICON, LANE_LABEL, formatReplayTime } from './replay-model.js';

const LANES = ['intent', 'actions', 'artifacts', 'risk'] as const;
/** Marker cap keeps 10k-event sessions scrubbable; mandatory facts always render. */
const MAX_MARKERS = 480;

/**
 * The semantic timeline (persistent at every depth): four lanes, story/real
 * time, a coverage band for the exact interval, and the transport controls.
 */
export function SemanticTimeline({
  controller,
  projection,
}: {
  controller: ReplayController;
  projection: ReplayProjection;
}): React.JSX.Element {
  const { facts, session } = projection;
  const { timeMode, playheadMs, durationMs, currentIndex } = controller;

  const positionOf = (fact: ReplayFactDto) =>
    durationMs > 0
      ? ((timeMode === 'story' ? fact.storyStartMs : fact.actualStartMs) / durationMs) * 100
      : 0;

  const markers = useMemo(() => {
    if (facts.length <= MAX_MARKERS) return facts.map((fact, index) => ({ fact, index }));
    const chosen: Array<{ fact: ReplayFactDto; index: number }> = [];
    const stride = Math.ceil(facts.length / (MAX_MARKERS / 2));
    const seenGroups = new Set<string>();
    facts.forEach((fact, index) => {
      if (fact.mandatory) {
        chosen.push({ fact, index });
        return;
      }
      if (fact.groupKey) {
        const key = `${fact.groupKey}:${fact.storyStartMs}`;
        if (seenGroups.has(key)) return;
        seenGroups.add(key);
        chosen.push({ fact, index });
        return;
      }
      if (index % stride === 0) chosen.push({ fact, index });
    });
    return chosen;
  }, [facts]);

  const coverageTotal = timeMode === 'story' ? session.storyDurationMs : session.actualDurationMs;

  return (
    <footer className="rp-timeline" data-testid="replay-timeline">
      <div className="rp-transport">
        <button
          className="rp-skip"
          data-testid="replay-prev"
          disabled={currentIndex === 0}
          onClick={() => controller.stepBy(-1)}
          aria-label="Previous event"
        >
          <Ic name="chevron" size={14} className="rp-flip" />
        </button>
        <button className="rp-play" data-testid="replay-play" onClick={controller.togglePlay}>
          <Ic name={controller.playing ? 'pause' : 'play'} size={14} />
          {controller.playing ? 'Pause' : 'Replay'}
        </button>
        <button
          className="rp-skip"
          data-testid="replay-next"
          disabled={currentIndex >= facts.length - 1}
          onClick={() => controller.stepBy(1)}
          aria-label="Next event"
        >
          <Ic name="chevron" size={14} />
        </button>
        <time aria-live="off">
          {formatReplayTime(playheadMs)} / {formatReplayTime(durationMs)}
        </time>
        <div
          className="rp-time-mode"
          data-testid="replay-time-mode"
          role="group"
          aria-label="Time projection"
        >
          <Ic name="clock" size={12} />
          <button
            className={timeMode === 'story' ? 'active' : ''}
            data-testid="replay-time-story"
            onClick={() => controller.setTimeMode('story')}
          >
            故事时间
          </button>
          <button
            className={timeMode === 'actual' ? 'active' : ''}
            data-testid="replay-time-actual"
            onClick={() => controller.setTimeMode('actual')}
          >
            真实时间
          </button>
        </div>
        {controller.live ? (
          <button
            className={`rp-live-follow ${controller.liveFollow ? 'active' : ''}`}
            data-testid="replay-live-follow"
            onClick={() => controller.setLiveFollow(!controller.liveFollow)}
          >
            <i aria-hidden />
            {controller.liveFollow ? '跟随中' : '跟随最新'}
          </button>
        ) : null}
        <span className="rp-count" data-testid="replay-count">
          step {currentIndex + 1} / {facts.length}
        </span>
        <select
          value={controller.speed}
          onChange={(event) => controller.setSpeed(Number(event.target.value))}
          aria-label="Playback speed"
        >
          {[1, 2, 4, 8, 16].map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
      </div>
      <div className="rp-lanes-wrap">
        <div className="rp-lanes">
          {LANES.map((lane) => (
            <div className="rp-lane" key={lane}>
              <span>{LANE_LABEL[lane]}</span>
              <div className="rp-lane-track">
                {markers
                  .filter(({ fact }) => fact.lane === lane)
                  .map(({ fact, index }) => (
                    <button
                      key={fact.id}
                      className={`rp-marker rp-marker-${fact.level} ${index === currentIndex ? 'active' : ''} ${fact.mandatory ? 'mandatory' : ''}`}
                      style={{ left: `${positionOf(fact)}%` }}
                      onClick={() => controller.selectIndex(index)}
                      title={`${formatReplayTime(timeMode === 'story' ? fact.storyStartMs : fact.actualStartMs)} · ${fact.action}`}
                      aria-label={fact.action}
                    >
                      <Ic name={KIND_ICON[fact.kind] ?? 'info'} size={9} />
                    </button>
                  ))}
              </div>
            </div>
          ))}
          <div
            className="rp-playhead"
            style={{ left: `${durationMs > 0 ? (playheadMs / durationMs) * 100 : 0}%` }}
            aria-hidden
          />
        </div>
        <input
          className="rp-range"
          type="range"
          data-testid="replay-scrubber"
          min={0}
          max={Math.max(1, durationMs)}
          step={Math.max(1, Math.floor(durationMs / 5000))}
          value={Math.min(playheadMs, durationMs)}
          onChange={(event) => controller.seek(Number(event.target.value))}
          aria-label="Replay timeline"
        />
        <div
          className="rp-coverage-band"
          data-testid="replay-coverage"
          aria-label="Capture coverage by interval"
        >
          {session.coverage.map((segment, index) => {
            const start = timeMode === 'story' ? segment.storyStartMs : segment.actualStartMs;
            const end = timeMode === 'story' ? segment.storyEndMs : segment.actualEndMs;
            const width = coverageTotal > 0 ? ((end - start) / coverageTotal) * 100 : 0;
            if (width <= 0) return null;
            return (
              <i
                key={`${segment.level}-${index}`}
                className={`rp-cov-${segment.level}`}
                style={{ width: `${width}%` }}
                title={`${segment.level}`}
              />
            );
          })}
        </div>
      </div>
    </footer>
  );
}
