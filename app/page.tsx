"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const GAME_WIDTH = 480;
const GAME_HEIGHT = 720;
const ROAD_LEFT = 42;
const ROAD_WIDTH = 396;
const LANE_WIDTH = ROAD_WIDTH / 5;
const PLAYER_Y = 584;
const STARTING_FANS = 0;
const TRAVEL_BEATS = 4;
const MISS_WINDOW = 190;
const HIT_INPUT_GUARD_MS = 70;
const POWERUP_DURATION_MS = 5_000;
const MAGNET_RADIUS = 185;
const MIN_PLAYABLE_STRONG_BEATS = 90;
const MIN_STRONG_BEAT_GAP = 2;
const MIN_OBSTACLE_BEAT_GAP = 3;
const POWERUP_TRAIL_DELAY_MS = 220;
const STADIUM_SCORE_THRESHOLD = 6_500;
const OBSTACLE_COLLISION_BEFORE = 36;
const OBSTACLE_COLLISION_AFTER = 40;

type GameStatus =
  | "ready"
  | "playing"
  | "paused"
  | "lucky"
  | "finished"
  | "failed";
type EntityType =
  | "fan"
  | "obstacle"
  | "lucky"
  | "magnet"
  | "invincible";
type ObstacleType = "cone" | "speaker" | "barrier";
type ToastTone = "cyan" | "pink" | "gold" | "danger";
type TrackId =
  | "guaihuo"
  | "lueluelue"
  | "earth-tour"
  | "custom-upload";
type ToneMode = "normal" | "thick" | "thin";
type MapTheme = "illusion-city" | "candy-blocks" | "earth-orbit" | "custom";
type ReadyPage = "rules" | "songs";

type VehicleLevel = {
  level: number;
  name: string;
  capacity: number;
  primary: string;
  secondary: string;
  task: string;
  requirement?: {
    hits: number;
    perfect?: number;
    maxCombo?: number;
  };
};

type Entity = {
  id: number;
  type: EntityType;
  lane: number;
  y: number;
  targetBeat: number;
  spawnAt: number;
  hitAt: number;
  obstacle?: ObstacleType;
  handled: boolean;
  wobble: number;
};

type Pedestrian = {
  startAt: number;
  hitAt: number;
  endAt: number;
  direction: 1 | -1;
  x: number;
  y: number;
};

type NoteJudgement = {
  quality: "PERFECT" | "GREAT" | "GOOD" | "MISS";
  detail: string;
  key: number;
};

type LuckyDialog =
  | { phase: "choice" }
  | {
      phase: "result";
      outcome: "double" | "half";
      before: number;
      after: number;
      capacity: number;
      capped: boolean;
    };

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
};

type FloatText = {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
};

type ConcertTier = {
  name: string;
  place: string;
  coins: number;
  color: string;
  icon: string;
};

type LeaderboardEntry = {
  id: number;
  playerId: string;
  name: string;
  fans: number;
  maxCombo: number;
  score: number;
  concert: string;
  song: string;
  createdAt: number;
};

type Track = {
  id: TrackId;
  name: string;
  artist: string;
  english: string;
  description: string;
  tempoLabel: string;
  difficulty: string;
  color: string;
  audioSrc?: string;
  mapTheme: MapTheme;
  mapLabel: string;
  totalBeats: number;
  grannyBeat: number;
  melody: number[];
  lanePattern: number[];
  notePattern: number[];
  intensityPattern: number[];
  bpmAt: (beat: number) => number;
};

const VEHICLE_LEVELS: VehicleLevel[] = [
  {
    level: 1,
    name: "星芽小巴",
    capacity: 30,
    primary: "#ff4fa3",
    secondary: "#ff78bf",
    task: "本局 HIT 4 次 + PERFECT 1 次",
    requirement: { hits: 4, perfect: 1 },
  },
  {
    level: 2,
    name: "应援大巴",
    capacity: 55,
    primary: "#6a5cff",
    secondary: "#9c8cff",
    task: "本局 HIT 12 次 + 最高连击 6",
    requirement: { hits: 12, maxCombo: 6 },
  },
  {
    level: 3,
    name: "巡演豪华号",
    capacity: 85,
    primary: "#00b9c8",
    secondary: "#72f1ff",
    task: "本局 HIT 22 次 + PERFECT 7 次 + 最高连击 10",
    requirement: { hits: 22, perfect: 7, maxCombo: 10 },
  },
  {
    level: 4,
    name: "银河应援号",
    capacity: 120,
    primary: "#e9a900",
    secondary: "#ffe66d",
    task: "已达最高等级",
  },
];

function getVehicle(level: number) {
  return VEHICLE_LEVELS[Math.max(0, Math.min(VEHICLE_LEVELS.length - 1, level - 1))];
}

function isVehicleTaskComplete(
  vehicle: VehicleLevel,
  hits: number,
  perfect: number,
  maxCombo: number,
) {
  const requirement = vehicle.requirement;
  if (!requirement) return false;
  return (
    hits >= requirement.hits &&
    perfect >= (requirement.perfect ?? 0) &&
    maxCombo >= (requirement.maxCombo ?? 0)
  );
}

function getVehicleTaskProgress(
  vehicle: VehicleLevel,
  hits: number,
  perfect: number,
  maxCombo: number,
) {
  const requirement = vehicle.requirement;
  if (!requirement) return 100;
  const progressParts = [hits / requirement.hits];
  if (requirement.perfect) progressParts.push(perfect / requirement.perfect);
  if (requirement.maxCombo) progressParts.push(maxCombo / requirement.maxCombo);
  return Math.round(Math.min(1, Math.min(...progressParts)) * 100);
}

const TRACKS: Track[] = [
  {
    id: "guaihuo",
    name: "怪火",
    artist: "aespa",
    english: "ILLUSION",
    description: "低频强拍谱面 · 重拍折返换道",
    tempoLabel: "AUTO MAP",
    difficulty: "HARD",
    color: "#ff5b9f",
    audioSrc: "/audio/guaihuo.mp3",
    mapTheme: "illusion-city",
    mapLabel: "幻火夜城",
    totalBeats: 96,
    grannyBeat: 48,
    melody: [220, 277.18, 329.63, 440, 415.3, 329.63, 277.18, 246.94],
    lanePattern: [2, 3, 2, 1, 0, 1, 3, 4],
    notePattern: [1],
    intensityPattern: [0.7],
    bpmAt: () => 96,
  },
  {
    id: "lueluelue",
    name: "略略略略略",
    artist: "TOP登陆少年组合",
    english: "LUE LUE LUE",
    description: "跳跃节拍谱面 · 高频连续变道",
    tempoLabel: "AUTO MAP",
    difficulty: "EXPERT",
    color: "#ffe66d",
    audioSrc: "/audio/lueluelue.mp3",
    mapTheme: "candy-blocks",
    mapLabel: "糖果街区",
    totalBeats: 96,
    grannyBeat: 52,
    melody: [246.94, 329.63, 392, 493.88, 440, 392, 329.63, 293.66],
    lanePattern: [2, 1, 3, 4, 2, 0, 1, 3],
    notePattern: [1],
    intensityPattern: [0.7],
    bpmAt: () => 112,
  },
  {
    id: "earth-tour",
    name: "昨晚我环游了地球",
    artist: "汪苏泷",
    english: "AROUND THE EARTH",
    description: "旋律流动谱面 · 随段落能量展开",
    tempoLabel: "AUTO MAP",
    difficulty: "NORMAL",
    color: "#72f1ff",
    audioSrc: "/audio/earth-tour.mp3",
    mapTheme: "earth-orbit",
    mapLabel: "星球环线",
    totalBeats: 96,
    grannyBeat: 44,
    melody: [196, 246.94, 293.66, 369.99, 329.63, 293.66, 246.94, 220],
    lanePattern: [2, 2, 3, 4, 3, 2, 1, 0],
    notePattern: [1],
    intensityPattern: [0.6],
    bpmAt: () => 92,
  },
  {
    id: "custom-upload",
    name: "自选歌曲",
    artist: "本地音乐",
    english: "CUSTOM TRACK",
    description: "上传本地歌曲，自动分析鼓点与节拍",
    tempoLabel: "AUTO BPM",
    difficulty: "RHYTHM",
    color: "#ffe66d",
    mapTheme: "custom",
    mapLabel: "自定义巡演",
    totalBeats: 96,
    grannyBeat: 42,
    melody: [220, 277.18, 329.63, 440, 415.3, 329.63, 277.18, 246.94],
    lanePattern: [
      2, 3, 2, 1, 0, 1, 3, 4, 3, 1, 2, 4, 3, 2, 0, 1,
      2, 4, 3, 2, 1, 0, 2, 3, 4, 2, 0, 1, 3, 4, 2, 1,
    ],
    notePattern: [1],
    intensityPattern: [0.65],
    bpmAt: () => 96,
  },
];

const MAP_PALETTES: Record<
  MapTheme,
  {
    sky: string;
    sidewalk: string;
    building: string;
    road: string;
    edgeLeft: string;
    edgeRight: string;
    windowA: string;
    windowB: string;
  }
> = {
  "illusion-city": {
    sky: "#09061b",
    sidewalk: "#1c1037",
    building: "#32184d",
    road: "#120f24",
    edgeLeft: "#ff4fa3",
    edgeRight: "#8a5cff",
    windowA: "#ff6e3f",
    windowB: "#ff4fa3",
  },
  "candy-blocks": {
    sky: "#120d2d",
    sidewalk: "#27194c",
    building: "#56326b",
    road: "#17122d",
    edgeLeft: "#ffe66d",
    edgeRight: "#ff73bd",
    windowA: "#ffe66d",
    windowB: "#72f1ff",
  },
  "earth-orbit": {
    sky: "#050f2b",
    sidewalk: "#0c2450",
    building: "#163466",
    road: "#071a33",
    edgeLeft: "#72f1ff",
    edgeRight: "#4f7cff",
    windowA: "#72f1ff",
    windowB: "#bca7ff",
  },
  custom: {
    sky: "#090823",
    sidewalk: "#15113b",
    building: "#272054",
    road: "#111129",
    edgeLeft: "#72f1ff",
    edgeRight: "#ff4fa3",
    windowA: "#ff4faf",
    windowB: "#5ff6ff",
  },
};

function getTrack(id: TrackId) {
  return TRACKS.find((track) => track.id === id) ?? TRACKS[0];
}

function getBeatTimes(track: Track) {
  const times = [0];
  for (let beat = 0; beat < track.totalBeats + TRAVEL_BEATS + 2; beat += 1) {
    times.push(times[times.length - 1] + 60_000 / track.bpmAt(beat));
  }
  return times;
}

function analyzeAudioBuffer(buffer: AudioBuffer) {
  const hopSize = 1024;
  const frameCount = Math.floor(buffer.length / hopSize);
  const envelope = new Float32Array(frameCount);
  const channels = Math.min(2, buffer.numberOfChannels);

  for (let frame = 0; frame < frameCount; frame += 1) {
    let energy = 0;
    const start = frame * hopSize;
    const end = Math.min(start + hopSize, buffer.length);
    for (let channel = 0; channel < channels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let sample = start; sample < end; sample += 4) {
        energy += Math.abs(data[sample]);
      }
    }
    envelope[frame] = energy / Math.max(1, ((end - start) / 4) * channels);
  }

  const flux = new Float32Array(frameCount);
  for (let frame = 1; frame < frameCount; frame += 1) {
    flux[frame] = Math.max(0, envelope[frame] - envelope[frame - 1]);
  }

  const secondsPerFrame = hopSize / buffer.sampleRate;
  const onsets: Array<{ time: number; strength: number }> = [];
  let lastOnset = -1;
  const rollingRadius = Math.max(4, Math.round(0.45 / secondsPerFrame));
  const minGapFrames = Math.max(1, Math.round(0.16 / secondsPerFrame));

  for (let frame = rollingRadius; frame < frameCount - rollingRadius; frame += 1) {
    let localAverage = 0;
    for (let index = frame - rollingRadius; index <= frame + rollingRadius; index += 1) {
      localAverage += flux[index];
    }
    localAverage /= rollingRadius * 2 + 1;
    const isPeak = flux[frame] > flux[frame - 1] && flux[frame] >= flux[frame + 1];
    if (
      isPeak &&
      flux[frame] > Math.max(0.002, localAverage * 1.45) &&
      frame - lastOnset >= minGapFrames
    ) {
      onsets.push({ time: frame * secondsPerFrame, strength: flux[frame] });
      lastOnset = frame;
    }
  }

  const bpmScores = new Map<number, number>();
  const strongest = [...onsets]
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 220)
    .sort((a, b) => a.time - b.time);

  for (let first = 0; first < strongest.length; first += 1) {
    for (let second = first + 1; second < Math.min(strongest.length, first + 9); second += 1) {
      const gap = strongest[second].time - strongest[first].time;
      if (gap < 0.28 || gap > 1.35) continue;
      let candidate = 60 / gap;
      while (candidate < 78) candidate *= 2;
      while (candidate > 168) candidate /= 2;
      const rounded = Math.round(candidate);
      const weight = Math.sqrt(strongest[first].strength * strongest[second].strength);
      bpmScores.set(rounded, (bpmScores.get(rounded) ?? 0) + weight);
    }
  }

  let bpm = 96;
  let bestScore = -1;
  for (const [candidate, score] of bpmScores) {
    const smoothed =
      score +
      (bpmScores.get(candidate - 1) ?? 0) * 0.55 +
      (bpmScores.get(candidate + 1) ?? 0) * 0.55;
    if (smoothed > bestScore) {
      bestScore = smoothed;
      bpm = candidate;
    }
  }

  const beatInterval = 60 / bpm;
  const phaseCandidates = strongest.filter((onset) => onset.time < Math.min(20, buffer.duration));
  let phase = phaseCandidates[0]?.time ?? 0;
  let phaseScore = -1;
  for (const candidate of phaseCandidates.slice(0, 80)) {
    let score = 0;
    for (const onset of strongest) {
      const distanceInBeats = Math.abs((onset.time - candidate.time) / beatInterval);
      const distanceToGrid = Math.abs(distanceInBeats - Math.round(distanceInBeats));
      if (distanceToGrid < 0.16) {
        score += onset.strength * (1 - distanceToGrid / 0.16);
      }
    }
    if (score > phaseScore) {
      phaseScore = score;
      phase = candidate.time;
    }
  }

  while (phase - beatInterval >= 0) phase -= beatInterval;
  const beatTimes: number[] = [];
  for (let time = phase; time <= buffer.duration; time += beatInterval) {
    beatTimes.push(Math.round(time * 1000));
  }
  if (beatTimes.length < 12) {
    beatTimes.length = 0;
    for (let time = 0; time <= buffer.duration; time += 60 / 96) {
      beatTimes.push(Math.round(time * 1000));
    }
    bpm = 96;
  }

  const beatFeatures = beatTimes.map((time) => {
    const frame = Math.min(
      flux.length - 1,
      Math.max(0, Math.round(time / 1000 / secondsPerFrame)),
    );
    let onset = 0;
    let energy = 0;
    let samples = 0;
    for (
      let index = Math.max(0, frame - 3);
      index <= Math.min(flux.length - 1, frame + 3);
      index += 1
    ) {
      onset = Math.max(onset, flux[index]);
      energy += envelope[index];
      samples += 1;
    }
    return { onset, energy: energy / Math.max(1, samples) };
  });
  const percentile = (values: number[], ratio: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
  };
  const onsetReference = Math.max(
    0.0001,
    percentile(
      beatFeatures.map((feature) => feature.onset),
      0.82,
    ),
  );
  const energyFloor = percentile(
    beatFeatures.map((feature) => feature.energy),
    0.16,
  );
  const energyReference = Math.max(
    energyFloor + 0.0001,
    percentile(
      beatFeatures.map((feature) => feature.energy),
      0.78,
    ),
  );
  const intensityPattern = beatFeatures.map((feature) => {
    const onsetStrength = Math.min(1, feature.onset / onsetReference);
    const bodyStrength = Math.min(
      1,
      Math.max(
        0,
        (feature.energy - energyFloor) / (energyReference - energyFloor),
      ),
    );
    return Math.round((onsetStrength * 0.72 + bodyStrength * 0.28) * 100) / 100;
  });
  const notePattern = intensityPattern.map((intensity, beat) => {
    const feature = beatFeatures[beat];
    const hasBody = feature.energy > Math.max(0.002, energyFloor * 0.72);
    if (!hasBody) return 0;
    if (intensity >= 0.72 || (beat % 4 === 0 && intensity >= 0.42)) return 2;
    if (intensity >= 0.34 || (beat % 2 === 0 && intensity >= 0.24)) return 1;
    return 0;
  });

  // Avoid long empty stretches in sustained sections, while keeping intros and
  // breakdowns sparse. Every inserted note still sits on the analysed beat grid.
  let emptyRun = 0;
  for (let beat = 0; beat < notePattern.length; beat += 1) {
    if (notePattern[beat] > 0) {
      emptyRun = 0;
      continue;
    }
    emptyRun += 1;
    if (
      emptyRun >= 4 &&
      beatFeatures[beat].energy > Math.max(0.002, energyFloor)
    ) {
      notePattern[beat] = 1;
      emptyRun = 0;
    }
  }

  // Keep the top venue difficult but achievable. Each full-length map exposes
  // at least 90 genuine musical accents, which is enough to reach 6,500 points
  // with a strong run. Adjacent accents are thinned so dense choruses never
  // make the road feel as though the song itself suddenly sped up.
  const lastPlayableBeat = notePattern.length - 2;
  let previousStrongBeat = -Infinity;
  for (
    let beat = TRAVEL_BEATS;
    beat <= lastPlayableBeat;
    beat += 1
  ) {
    if (notePattern[beat] !== 2) continue;
    if (beat - previousStrongBeat >= MIN_STRONG_BEAT_GAP) {
      previousStrongBeat = beat;
      continue;
    }
    if (intensityPattern[beat] > intensityPattern[previousStrongBeat]) {
      notePattern[previousStrongBeat] = 1;
      previousStrongBeat = beat;
    } else {
      notePattern[beat] = 1;
    }
  }
  const playableStrongBeats = () =>
    notePattern
      .slice(TRAVEL_BEATS, lastPlayableBeat + 1)
      .filter((level) => level === 2).length;
  const targetStrongBeats = Math.min(
    MIN_PLAYABLE_STRONG_BEATS,
    Math.ceil(
      Math.max(0, lastPlayableBeat - TRAVEL_BEATS + 1) /
        MIN_STRONG_BEAT_GAP,
    ),
  );
  if (playableStrongBeats() < targetStrongBeats) {
    const strongestEmptyBars: number[] = [];
    for (
      let barStart = TRAVEL_BEATS;
      barStart <= lastPlayableBeat;
      barStart += 4
    ) {
      const barEnd = Math.min(lastPlayableBeat, barStart + 3);
      const barBeats = Array.from(
        { length: barEnd - barStart + 1 },
        (_, index) => barStart + index,
      );
      if (barBeats.some((beat) => notePattern[beat] === 2)) continue;
      const strongestBeat = barBeats
        .filter(
          (beat) =>
            beatFeatures[beat].energy > Math.max(0.002, energyFloor * 0.72),
        )
        .sort(
          (first, second) =>
            intensityPattern[second] - intensityPattern[first],
        )[0];
      if (strongestBeat !== undefined) strongestEmptyBars.push(strongestBeat);
    }

    const remainingAccents = Array.from(
      { length: Math.max(0, lastPlayableBeat - TRAVEL_BEATS + 1) },
      (_, index) => index + TRAVEL_BEATS,
    )
      .filter(
        (beat) =>
          notePattern[beat] !== 2 &&
          beatFeatures[beat].energy > Math.max(0.002, energyFloor * 0.72),
      )
      .sort(
        (first, second) =>
          intensityPattern[second] - intensityPattern[first],
      );
    const promotionOrder = [
      ...strongestEmptyBars.sort(
        (first, second) =>
          intensityPattern[second] - intensityPattern[first],
      ),
      ...remainingAccents,
    ];
    const promoted = new Set<number>();
    for (const beat of promotionOrder) {
      if (playableStrongBeats() >= targetStrongBeats) break;
      if (promoted.has(beat) || notePattern[beat] === 2) continue;
      const hasNearbyStrongBeat = Array.from(
        { length: MIN_STRONG_BEAT_GAP * 2 - 1 },
        (_, index) => beat - MIN_STRONG_BEAT_GAP + 1 + index,
      ).some(
        (nearbyBeat) =>
          nearbyBeat !== beat && notePattern[nearbyBeat] === 2,
      );
      if (hasNearbyStrongBeat) continue;
      notePattern[beat] = 2;
      promoted.add(beat);
    }

    // Extremely quiet or unusual uploads can leave too few audible candidates.
    // Fall back to the more energetic half-beat parity so the published maximum
    // combo remains honest without ever placing adjacent strong notes.
    if (playableStrongBeats() < targetStrongBeats) {
      const parityOptions = [0, 1].map((parity) => {
        const beats = Array.from(
          { length: Math.max(0, lastPlayableBeat - TRAVEL_BEATS + 1) },
          (_, index) => index + TRAVEL_BEATS,
        )
          .filter(
            (beat) => (beat - TRAVEL_BEATS) % MIN_STRONG_BEAT_GAP === parity,
          )
          .sort(
            (first, second) =>
              intensityPattern[second] - intensityPattern[first],
          )
          .slice(0, targetStrongBeats);
        return {
          beats,
          energy: beats.reduce(
            (total, beat) => total + intensityPattern[beat],
            0,
          ),
        };
      });
      const fallback =
        parityOptions[1].energy > parityOptions[0].energy
          ? parityOptions[1]
          : parityOptions[0];
      for (
        let beat = TRAVEL_BEATS;
        beat <= lastPlayableBeat;
        beat += 1
      ) {
        if (notePattern[beat] === 2) notePattern[beat] = 1;
      }
      for (const beat of fallback.beats) notePattern[beat] = 2;
    }
  }

  let lane = 2;
  let laneDirection: -1 | 1 = 1;
  const lanePattern = beatTimes.map((time, beat) => {
    if (
      beat > 0 &&
      notePattern[beat] > 0 &&
      (notePattern[beat] === 2 || beat % 4 === 0)
    ) {
      const audioSeed = Math.round(
        time + beatFeatures[beat].onset * 100_000 + beatFeatures[beat].energy * 10_000,
      );
      if (audioSeed % 3 === 0) {
        laneDirection = laneDirection === 1 ? -1 : 1;
      }
      const nextLane = lane + laneDirection;
      if (nextLane < 0 || nextLane > 4) {
        laneDirection = laneDirection === 1 ? -1 : 1;
      }
      lane = clampLane(lane + laneDirection);
    }
    return lane;
  });

  return { beatTimes, bpm, lanePattern, notePattern, intensityPattern };
}

type AudioAnalysis = ReturnType<typeof analyzeAudioBuffer>;

function laneCenter(lane: number) {
  return ROAD_LEFT + LANE_WIDTH * lane + LANE_WIDTH / 2;
}

function clampLane(lane: number) {
  return Math.max(0, Math.min(4, lane));
}

function getConcertTier(fans: number, maxCombo = 0): ConcertTier {
  const concertScore = fans * maxCombo;
  if (concertScore >= STADIUM_SCORE_THRESHOLD) {
    return {
      name: "星河体育场",
      place: "五万人全景演唱会",
      coins: 1080,
      color: "#ffe66d",
      icon: "✦",
    };
  }
  if (concertScore >= 4_500) {
    return {
      name: "霓虹体育馆",
      place: "万人应援演唱会",
      coins: 680,
      color: "#72f1ff",
      icon: "★",
    };
  }
  if (concertScore >= 2_800) {
    return {
      name: "城市剧场",
      place: "千人专场",
      coins: 420,
      color: "#ff7ac8",
      icon: "♪",
    };
  }
  if (concertScore >= 1_400) {
    return {
      name: "星光 Livehouse",
      place: "百人见面会",
      coins: 240,
      color: "#bca7ff",
      icon: "♫",
    };
  }
  return {
    name: "街角快闪",
    place: "小型惊喜舞台",
    coins: 100,
    color: "#a8ff78",
    icon: "♬",
  };
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const statusRef = useRef<GameStatus>("ready");
  const laneRef = useRef(2);
  const busXRef = useRef(laneCenter(2));
  const fansRef = useRef(STARTING_FANS);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const beatRef = useRef(0);
  const nextBeatRef = useRef(0);
  const beatTimesRef = useRef<number[]>(getBeatTimes(TRACKS[0]));
  const trackRef = useRef<Track>(TRACKS[0]);
  const startTimeRef = useRef(0);
  const lastTimeRef = useRef(0);
  const lastHudRef = useRef(0);
  const entityIdRef = useRef(0);
  const lastObstacleTargetBeatRef = useRef(-Infinity);
  const entitiesRef = useRef<Entity[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const floatTextRef = useRef<FloatText[]>([]);
  const pedestrianRef = useRef<Pedestrian | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const lowShelfRef = useRef<BiquadFilterNode | null>(null);
  const highShelfRef = useRef<BiquadFilterNode | null>(null);
  const songRef = useRef<HTMLAudioElement | null>(null);
  const songUrlRef = useRef<string | null>(null);
  const detectedBeatTimesRef = useRef<number[]>([]);
  const detectedLanePatternRef = useRef<number[]>(TRACKS[0].lanePattern);
  const detectedNotePatternRef = useRef<number[]>(TRACKS[0].notePattern);
  const detectedIntensityPatternRef = useRef<number[]>(
    TRACKS[0].intensityPattern,
  );
  const detectedBpmRef = useRef(96);
  const songLoadRequestRef = useRef(0);
  const analysisCacheRef = useRef<
    Partial<Record<TrackId, { analysis: AudioAnalysis; duration: number }>>
  >({});
  const mutedRef = useRef(false);
  const beatPulseRef = useRef(0);
  const shakeRef = useRef(0);
  const hitFlashRef = useRef(0);
  const collectFlashRef = useRef(0);
  const busBounceRef = useRef(0);
  const screenPunchRef = useRef(0);
  const invulnerableUntilRef = useRef(0);
  const shieldRef = useRef(false);
  const perfectCountRef = useRef(0);
  const successfulHitsRef = useRef(0);
  const vehicleLevelRef = useRef(1);
  const magnetUntilRef = useRef(-1);
  const invincibleUntilRef = useRef(-1);
  const toneModeRef = useRef<ToneMode>("normal");
  const arrangementUntilRef = useRef(-1);
  const grannyWarnedRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);
  const judgementTimerRef = useRef<number | null>(null);
  const lastHitInputAtRef = useRef(-Infinity);
  const playerNameRef = useRef("");
  const playerIdRef = useRef("");
  const joystickPointerRef = useRef<number | null>(null);
  const joystickDirectionRef = useRef<-1 | 0 | 1>(0);
  const joystickRepeatRef = useRef<number | null>(null);

  const [status, setStatus] = useState<GameStatus>("ready");
  const [readyPage, setReadyPage] = useState<ReadyPage>("rules");
  const [playerName, setPlayerName] = useState("");
  const [songReady, setSongReady] = useState(false);
  const [songLoading, setSongLoading] = useState(false);
  const [songFileName, setSongFileName] = useState("");
  const [songTitle, setSongTitle] = useState("未选择歌曲");
  const [songError, setSongError] = useState("");
  const [detectedBpm, setDetectedBpm] = useState(96);
  const [songDuration, setSongDuration] = useState(0);
  const [selectedTrackId, setSelectedTrackId] =
    useState<TrackId>("guaihuo");
  const [fans, setFans] = useState(STARTING_FANS);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [successfulHits, setSuccessfulHits] = useState(0);
  const [vehicleLevel, setVehicleLevel] = useState(1);
  const [magnetRemaining, setMagnetRemaining] = useState(0);
  const [invincibleRemaining, setInvincibleRemaining] = useState(0);
  const [progress, setProgress] = useState(0);
  const [beatIndex, setBeatIndex] = useState(0);
  const [currentBpm, setCurrentBpm] = useState(TRACKS[0].bpmAt(0));
  const [toneMode, setToneMode] = useState<ToneMode>("normal");
  const [muted, setMuted] = useState(false);
  const [shield, setShield] = useState(false);
  const [bestFans, setBestFans] = useState(0);
  const [bankCoins, setBankCoins] = useState(0);
  const [earnedCoins, setEarnedCoins] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [currentRankEntryId, setCurrentRankEntryId] = useState<string | null>(
    null,
  );
  const [joystickOffset, setJoystickOffset] = useState(0);
  const [noteJudgement, setNoteJudgement] =
    useState<NoteJudgement | null>(null);
  const [resultTier, setResultTier] = useState<ConcertTier>(
    getConcertTier(STARTING_FANS),
  );
  const [toast, setToast] = useState<{
    text: string;
    tone: ToastTone;
    key: number;
  } | null>(null);
  const [luckyDialog, setLuckyDialog] = useState<LuckyDialog | null>(null);
  const selectedTrack = getTrack(selectedTrackId);
  const currentVehicle = getVehicle(vehicleLevel);
  const vehicleTaskProgress = getVehicleTaskProgress(
    currentVehicle,
    successfulHits,
    perfectCountRef.current,
    maxCombo,
  );
  const leaderboardPanel = (
    <section className="leaderboard-panel" aria-label="玩家排行榜">
      <div className="leaderboard-heading">
        <span>PLAYER RANKING</span>
        <small>GLOBAL TOP 5</small>
      </div>
      {leaderboard.length > 0 ? (
        <div className="leaderboard-list">
          {leaderboard.map((entry, index) => (
            <div
              className={
                entry.playerId === currentRankEntryId ? "is-current" : undefined
              }
              key={entry.id}
            >
              <b>{String(index + 1).padStart(2, "0")}</b>
              <span>
                <strong>{entry.name}</strong>
                <small>
                  {entry.song} · {entry.concert}
                </small>
              </span>
              <em>{entry.score} PTS</em>
              <i>{entry.fans}F · ×{entry.maxCombo}</i>
            </div>
          ))}
        </div>
      ) : (
        <p className="leaderboard-empty">
          还没有全局成绩，完成第一场演唱会吧。
        </p>
      )}
    </section>
  );

  const showToast = useCallback((text: string, tone: ToastTone) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ text, tone, key: Date.now() });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 820);
  }, []);

  const showJudgement = useCallback(
    (quality: NoteJudgement["quality"], detail: string) => {
      if (judgementTimerRef.current) {
        window.clearTimeout(judgementTimerRef.current);
      }
      setNoteJudgement({ quality, detail, key: Date.now() });
      judgementTimerRef.current = window.setTimeout(
        () => setNoteJudgement(null),
        560,
      );
    },
    [],
  );

  const addBurst = useCallback(
    (x: number, y: number, color: string, count = 10) => {
      for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
        const speed = 45 + Math.random() * 95;
        particlesRef.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.65,
          maxLife: 0.65,
          color,
          size: 3 + Math.random() * 5,
        });
      }
    },
    [],
  );

  const addFloatText = useCallback(
    (x: number, y: number, text: string, color: string) => {
      floatTextRef.current.push({
        x,
        y,
        text,
        color,
        life: 0.9,
        maxLife: 0.9,
      });
    },
    [],
  );

  const resetSongTone = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      const now = audio.currentTime;
      lowShelfRef.current?.gain.setTargetAtTime(0, now, 0.08);
      highShelfRef.current?.gain.setTargetAtTime(0, now, 0.08);
    }
    if (songRef.current) songRef.current.playbackRate = 1;
    toneModeRef.current = "normal";
    arrangementUntilRef.current = -1;
    setToneMode("normal");
  }, []);

  const checkVehicleUpgrade = useCallback(() => {
    const current = getVehicle(vehicleLevelRef.current);
    if (
      current.level >= VEHICLE_LEVELS.length ||
      !isVehicleTaskComplete(
        current,
        successfulHitsRef.current,
        perfectCountRef.current,
        maxComboRef.current,
      )
    ) {
      return false;
    }

    const next = getVehicle(current.level + 1);
    vehicleLevelRef.current = next.level;
    setVehicleLevel(next.level);
    setNoteJudgement(null);
    screenPunchRef.current = 1.8;
    collectFlashRef.current = 1.4;
    busBounceRef.current = 1.35;
    addBurst(busXRef.current, PLAYER_Y - 18, next.secondary, 46);
    addFloatText(
      busXRef.current,
      PLAYER_Y - 96,
      `BUS LV.${next.level}  容量 ${next.capacity}`,
      next.secondary,
    );
    showToast(`车辆升级！${next.name} · 容量 ${next.capacity}`, "gold");
    navigator.vibrate?.([35, 25, 45, 25, 65]);
    return true;
  }, [addBurst, addFloatText, showToast]);

  const playFanHit = useCallback((targetBeat: number) => {
    const audio = audioRef.current;
    if (!audio || mutedRef.current) return;
    const now = audio.currentTime;
    const base =
      trackRef.current.melody[
        targetBeat % trackRef.current.melody.length
      ];

    [base, base * 2].forEach((frequency, index) => {
      const sparkle = audio.createOscillator();
      const gain = audio.createGain();
      sparkle.type = index === 0 ? "square" : "sine";
      sparkle.frequency.setValueAtTime(frequency, now + index * 0.045);
      gain.gain.setValueAtTime(index === 0 ? 0.085 : 0.055, now + index * 0.045);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        now + 0.2 + index * 0.045,
      );
      sparkle.connect(gain).connect(audio.destination);
      sparkle.start(now + index * 0.045);
      sparkle.stop(now + 0.22 + index * 0.045);
    });
  }, []);

  const installPreparedSong = useCallback(
    async ({
      track,
      title,
      fileName,
      sourceUrl,
      objectUrl,
      analysis,
      duration,
    }: {
      track: Track;
      title: string;
      fileName: string;
      sourceUrl: string;
      objectUrl: boolean;
      analysis: AudioAnalysis;
      duration: number;
    }) => {
      songRef.current?.pause();
      if (audioRef.current) {
        await audioRef.current.close();
        audioRef.current = null;
      }
      mediaSourceRef.current = null;
      lowShelfRef.current = null;
      highShelfRef.current = null;
      if (songUrlRef.current) {
        URL.revokeObjectURL(songUrlRef.current);
        songUrlRef.current = null;
      }

      const song = new Audio(sourceUrl);
      song.preload = "auto";
      song.muted = mutedRef.current;
      song.playbackRate = 1;

      songUrlRef.current = objectUrl ? sourceUrl : null;
      songRef.current = song;
      detectedBeatTimesRef.current = analysis.beatTimes;
      detectedLanePatternRef.current = analysis.lanePattern;
      detectedNotePatternRef.current = analysis.notePattern;
      detectedIntensityPatternRef.current = analysis.intensityPattern;
      detectedBpmRef.current = analysis.bpm;
      setSongFileName(fileName);
      setSongTitle(title);
      setDetectedBpm(analysis.bpm);
      setSongDuration(duration);
      setCurrentBpm(analysis.bpm);
      setSongReady(true);
      showToast(
        `${track.mapLabel}谱面完成 · ${analysis.bpm} BPM`,
        "gold",
      );
    },
    [showToast],
  );

  const loadBuiltInTrack = useCallback(
    async (trackId: Exclude<TrackId, "custom-upload">) => {
      const track = getTrack(trackId);
      if (!track.audioSrc) return;
      const requestId = ++songLoadRequestRef.current;
      setSelectedTrackId(trackId);
      setSongLoading(true);
      setSongReady(false);
      setSongError("");
      setSongTitle(track.name);
      setSongFileName("");

      try {
        const cached = analysisCacheRef.current[trackId];
        if (cached) {
          await installPreparedSong({
            track,
            title: track.name,
            fileName: `${track.name}.mp3`,
            sourceUrl: track.audioSrc,
            objectUrl: false,
            analysis: cached.analysis,
            duration: cached.duration,
          });
          return;
        }

        const response = await fetch(track.audioSrc);
        if (!response.ok) {
          throw new Error("内置歌曲读取失败，请刷新页面重试");
        }
        const AudioContextClass =
          window.AudioContext ||
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;
        if (!AudioContextClass) {
          throw new Error("当前浏览器不支持音频节拍分析");
        }
        const analysisContext = new AudioContextClass();
        const decoded = await analysisContext.decodeAudioData(
          await response.arrayBuffer(),
        );
        const analysis = analyzeAudioBuffer(decoded);
        const duration = decoded.duration;
        await analysisContext.close();
        if (requestId !== songLoadRequestRef.current) return;

        analysisCacheRef.current[trackId] = { analysis, duration };
        await installPreparedSong({
          track,
          title: track.name,
          fileName: `${track.name}.mp3`,
          sourceUrl: track.audioSrc,
          objectUrl: false,
          analysis,
          duration,
        });
      } catch (error) {
        if (requestId !== songLoadRequestRef.current) return;
        setSongError(
          error instanceof Error
            ? error.message
            : "歌曲解析失败，请换一首歌曲",
        );
        setSongReady(false);
      } finally {
        if (requestId === songLoadRequestRef.current) {
          setSongLoading(false);
        }
      }
    },
    [installPreparedSong],
  );

  const handleSongUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const requestId = ++songLoadRequestRef.current;
      setSelectedTrackId("custom-upload");
      setSongLoading(true);
      setSongReady(false);
      setSongError("");
      setSongFileName(file.name);
      setSongTitle(file.name.replace(/\.[^.]+$/, ""));

      try {
        if (/\.mgg$/i.test(file.name)) {
          throw new Error("MGG 是音乐平台专有格式，请上传 MP3、M4A、WAV 或 AAC");
        }
        const supportedExtension = /\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(file.name);
        if (!file.type.startsWith("audio/") && !supportedExtension) {
          throw new Error("请选择 MP3、M4A、WAV 等音频文件");
        }
        if (file.size > 80 * 1024 * 1024) {
          throw new Error("音频文件请控制在 80MB 以内");
        }
        const AudioContextClass =
          window.AudioContext ||
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;
        if (!AudioContextClass) {
          throw new Error("当前浏览器不支持音频节拍分析");
        }

        const analysisContext = new AudioContextClass();
        const decoded = await analysisContext.decodeAudioData(
          await file.arrayBuffer(),
        );
        const analysis = analyzeAudioBuffer(decoded);
        const duration = decoded.duration;
        await analysisContext.close();
        if (requestId !== songLoadRequestRef.current) return;
        const url = URL.createObjectURL(file);
        await installPreparedSong({
          track: getTrack("custom-upload"),
          title: file.name.replace(/\.[^.]+$/, ""),
          fileName: file.name,
          sourceUrl: url,
          objectUrl: true,
          analysis,
          duration,
        });
      } catch (error) {
        if (requestId !== songLoadRequestRef.current) return;
        const message =
          error instanceof Error ? error.message : "音频解析失败，请换一个文件";
        setSongError(message);
        setSongFileName("");
        setSongTitle("未选择歌曲");
        songRef.current = null;
      } finally {
        if (requestId === songLoadRequestRef.current) {
          setSongLoading(false);
        }
        event.target.value = "";
      }
    },
    [installPreparedSong],
  );

  const playBeat = useCallback((beat: number) => {
    const audio = audioRef.current;
    if (!audio || mutedRef.current) return;

    const track = trackRef.current;
    const isVariation = beat < arrangementUntilRef.current;
    const pitchRatio =
      toneModeRef.current === "thick"
        ? 0.84
        : toneModeRef.current === "thin"
          ? 1.18
          : 1;
    const beatSeconds = 60 / track.bpmAt(beat);
    const now = audio.currentTime;
    const kick = audio.createOscillator();
    const kickGain = audio.createGain();
    kick.type = "sine";
    kick.frequency.setValueAtTime(isVariation ? 92 : 120, now);
    kick.frequency.exponentialRampToValueAtTime(isVariation ? 38 : 48, now + 0.13);
    kickGain.gain.setValueAtTime(isVariation ? 0.42 : 0.34, now);
    kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    kick.connect(kickGain).connect(audio.destination);
    kick.start(now);
    kick.stop(now + 0.18);

    // The imported song is the backing track. Keep only a short arcade click
    // on top so the player can feel the analysed beat without masking the song.
    if (songRef.current) return;

    const note = audio.createOscillator();
    const noteGain = audio.createGain();
    note.type = isVariation ? "sawtooth" : beat % 4 === 0 ? "square" : "triangle";
    note.frequency.setValueAtTime(
      track.melody[beat % track.melody.length] * pitchRatio,
      now,
    );
    note.detune.setValueAtTime(isVariation && beat % 2 ? -18 : 0, now);
    noteGain.gain.setValueAtTime(
      isVariation ? 0.055 : beat % 2 === 0 ? 0.075 : 0.045,
      now,
    );
    noteGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    note.connect(noteGain).connect(audio.destination);
    note.start(now);
    note.stop(now + 0.17);

    if (beat % 2 === 0) {
      const bass = audio.createOscillator();
      const bassGain = audio.createGain();
      bass.type = isVariation ? "square" : "triangle";
      bass.frequency.setValueAtTime(
        (track.melody[(beat + 4) % track.melody.length] / 4) * pitchRatio,
        now,
      );
      bassGain.gain.setValueAtTime(0.07, now);
      bassGain.gain.exponentialRampToValueAtTime(0.001, now + beatSeconds * 0.72);
      bass.connect(bassGain).connect(audio.destination);
      bass.start(now);
      bass.stop(now + beatSeconds * 0.75);
    }

    if (beat % 4 === 2) {
      const snareBuffer = audio.createBuffer(
        1,
        Math.floor(audio.sampleRate * 0.11),
        audio.sampleRate,
      );
      const data = snareBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      }
      const snare = audio.createBufferSource();
      const snareGain = audio.createGain();
      snare.buffer = snareBuffer;
      snareGain.gain.setValueAtTime(0.1, now);
      snareGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      snare.connect(snareGain).connect(audio.destination);
      snare.start(now);
    }

    if (isVariation) {
      const echo = audio.createOscillator();
      const echoGain = audio.createGain();
      const echoStart = now + beatSeconds * 0.5;
      echo.type = "square";
      echo.frequency.setValueAtTime(
        track.melody[(beat + 3) % track.melody.length] * pitchRatio,
        echoStart,
      );
      echoGain.gain.setValueAtTime(0.038, echoStart);
      echoGain.gain.exponentialRampToValueAtTime(0.001, echoStart + 0.1);
      echo.connect(echoGain).connect(audio.destination);
      echo.start(echoStart);
      echo.stop(echoStart + 0.12);
    }
  }, []);

  const spawnBeat = useCallback((beat: number) => {
    const track = trackRef.current;
    if (beat >= track.totalBeats - TRAVEL_BEATS) return;

    const targetBeat = beat + TRAVEL_BEATS;
    const safeLane =
      track.lanePattern[targetBeat % track.lanePattern.length];
    const noteLevel =
      track.notePattern[targetBeat % track.notePattern.length] ?? 0;
    const intensity =
      track.intensityPattern[targetBeat % track.intensityPattern.length] ?? 0;
    if (noteLevel !== 2) return;
    const spawnY = -70;
    const spawnAt = beatTimesRef.current[beat];
    const hitAt = beatTimesRef.current[targetBeat];
    const activeNoteOrdinal = track.notePattern
      .slice(0, targetBeat + 1)
      .reduce((total, level) => total + (level === 2 ? 1 : 0), 0);

    const bonusType: EntityType | null =
      activeNoteOrdinal > 10 && activeNoteOrdinal % 28 === 8
        ? "magnet"
        : activeNoteOrdinal > 10 && activeNoteOrdinal % 28 === 20
          ? "invincible"
          : activeNoteOrdinal > 8 && activeNoteOrdinal % 19 === 0
            ? "lucky"
            : null;
    entitiesRef.current.push({
      id: entityIdRef.current++,
      type: "fan",
      lane: safeLane,
      y: spawnY,
      targetBeat,
      spawnAt,
      hitAt,
      handled: false,
      wobble: Math.random() * Math.PI,
    });
    if (bonusType) {
      entitiesRef.current.push({
        id: entityIdRef.current++,
        type: bonusType,
        lane: safeLane,
        y: spawnY,
        targetBeat,
        spawnAt: spawnAt + POWERUP_TRAIL_DELAY_MS,
        hitAt: hitAt + POWERUP_TRAIL_DELAY_MS,
        handled: false,
        wobble: Math.random() * Math.PI,
      });
    }

    if (beat < 2) return;
    if (
      targetBeat - lastObstacleTargetBeatRef.current <
      MIN_OBSTACLE_BEAT_GAP
    ) {
      return;
    }
    lastObstacleTargetBeatRef.current = targetBeat;
    const obstacleCount = beat > 12 && noteLevel === 2 && intensity > 0.68 ? 2 : 1;
    const used = new Set<number>([safeLane]);
    for (let i = 0; i < obstacleCount; i += 1) {
      let obstacleLane = (beat * 2 + i * 3) % 5;
      while (used.has(obstacleLane)) {
        obstacleLane = (obstacleLane + 1) % 5;
      }
      used.add(obstacleLane);
      const obstacleTypes: ObstacleType[] = ["cone", "speaker", "barrier"];
      entitiesRef.current.push({
        id: entityIdRef.current++,
        type: "obstacle",
        obstacle: obstacleTypes[(beat + i) % obstacleTypes.length],
        lane: obstacleLane,
        y: spawnY - i * 8,
        targetBeat,
        spawnAt,
        hitAt,
        handled: false,
        wobble: Math.random() * Math.PI,
      });
    }
  }, []);

  const triggerDamageVariation = useCallback(() => {
    const nextTone: ToneMode =
      toneModeRef.current === "thick"
        ? "thin"
        : toneModeRef.current === "thin"
          ? "thick"
          : beatRef.current % 2 === 0
            ? "thick"
            : "thin";
    toneModeRef.current = nextTone;
    arrangementUntilRef.current = beatRef.current + 8;
    setToneMode(nextTone);
    if (songRef.current) {
      // Tone filters change colour only; playbackRate stays fixed so the beat
      // grid and the original song tempo never drift apart.
      songRef.current.playbackRate = 1;
    }

    const audio = audioRef.current;
    if (audio) {
      const now = audio.currentTime;
      lowShelfRef.current?.gain.setTargetAtTime(
        nextTone === "thick" ? 11 : -8,
        now,
        0.055,
      );
      highShelfRef.current?.gain.setTargetAtTime(
        nextTone === "thick" ? -9 : 11,
        now,
        0.055,
      );
    }

    if (!audio || mutedRef.current) return;
    const now = audio.currentTime;
    const bend = audio.createOscillator();
    const bendGain = audio.createGain();
    bend.type = "sawtooth";
    bend.frequency.setValueAtTime(190, now);
    bend.frequency.exponentialRampToValueAtTime(72, now + 0.25);
    bendGain.gain.setValueAtTime(0.09, now);
    bendGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    bend.connect(bendGain).connect(audio.destination);
    bend.start(now);
    bend.stop(now + 0.3);
  }, []);

  const drawGame = useCallback(
    (ctx: CanvasRenderingContext2D, elapsed: number) => {
      const pulse = beatPulseRef.current;
      const activeTrack = trackRef.current;
      const palette = MAP_PALETTES[activeTrack.mapTheme];
      const visualSpeed = 180 + activeTrack.bpmAt(beatRef.current) * 1.2;
      const roadOffset = ((elapsed / 1000) * visualSpeed) % 92;
      const shakeX = shakeRef.current > 0 ? (Math.random() - 0.5) * 12 : 0;
      const shakeY = shakeRef.current > 0 ? (Math.random() - 0.5) * 8 : 0;

      ctx.save();
      ctx.translate(shakeX, shakeY);
      if (screenPunchRef.current > 0) {
        const scale = 1 + screenPunchRef.current * 0.014;
        ctx.translate(GAME_WIDTH / 2, GAME_HEIGHT / 2);
        ctx.scale(scale, scale);
        ctx.translate(-GAME_WIDTH / 2, -GAME_HEIGHT / 2);
      }
      ctx.clearRect(-16, -16, GAME_WIDTH + 32, GAME_HEIGHT + 32);
      ctx.fillStyle = palette.sky;
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

      // Pixel city and sidewalks.
      ctx.fillStyle = palette.sidewalk;
      ctx.fillRect(0, 0, ROAD_LEFT, GAME_HEIGHT);
      ctx.fillRect(ROAD_LEFT + ROAD_WIDTH, 0, GAME_WIDTH - ROAD_LEFT - ROAD_WIDTH, GAME_HEIGHT);
      for (let y = -92 + roadOffset; y < GAME_HEIGHT + 92; y += 92) {
        ctx.fillStyle = palette.building;
        ctx.fillRect(5, y, 31, 78);
        ctx.fillRect(444, y, 31, 78);
        ctx.fillStyle = y % 184 < 10 ? palette.windowA : palette.windowB;
        ctx.fillRect(10, y + 12, 10, 15);
        ctx.fillRect(459, y + 36, 10, 15);
        ctx.fillStyle = "#ffe66d";
        ctx.fillRect(24, y + 45, 6, 12);
        ctx.fillRect(447, y + 9, 6, 12);
        if (activeTrack.mapTheme === "illusion-city") {
          ctx.fillStyle = "#ff623f";
          ctx.fillRect(15, y + 61, 16, 8 + pulse * 5);
          ctx.fillStyle = "#ffb23f";
          ctx.fillRect(20, y + 55, 6, 9 + pulse * 4);
        } else if (activeTrack.mapTheme === "candy-blocks") {
          ctx.fillStyle = "#ff73bd";
          ctx.fillRect(7, y + 55, 12, 12);
          ctx.fillStyle = "#72f1ff";
          ctx.fillRect(22, y + 55, 12, 12);
        } else if (activeTrack.mapTheme === "earth-orbit") {
          ctx.fillStyle = "rgba(114, 241, 255, 0.7)";
          ctx.fillRect(15, y + 61, 3, 3);
          ctx.fillRect(28, y + 30, 3, 3);
          ctx.strokeStyle = "rgba(188, 167, 255, 0.5)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(458, y + 63, 10, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Neon road.
      ctx.fillStyle = palette.road;
      ctx.fillRect(ROAD_LEFT, 0, ROAD_WIDTH, GAME_HEIGHT);
      ctx.fillStyle = "#2a245b";
      ctx.fillRect(ROAD_LEFT, 0, 5, GAME_HEIGHT);
      ctx.fillRect(ROAD_LEFT + ROAD_WIDTH - 5, 0, 5, GAME_HEIGHT);
      ctx.globalAlpha = 0.34 + pulse * 0.5;
      ctx.fillStyle = palette.edgeLeft;
      ctx.fillRect(ROAD_LEFT + 5, 0, 2, GAME_HEIGHT);
      ctx.fillStyle = palette.edgeRight;
      ctx.fillRect(ROAD_LEFT + ROAD_WIDTH - 7, 0, 2, GAME_HEIGHT);
      ctx.globalAlpha = 1;

      for (let lane = 1; lane < 5; lane += 1) {
        const x = ROAD_LEFT + lane * LANE_WIDTH;
        for (let y = -60 + roadOffset; y < GAME_HEIGHT; y += 92) {
          ctx.fillStyle = `rgba(225, 231, 255, ${0.18 + pulse * 0.14})`;
          ctx.fillRect(Math.round(x - 2), Math.round(y), 4, 45);
        }
      }

      // Beat hit line.
      ctx.fillStyle = `rgba(255, 230, 109, ${0.06 + pulse * 0.22})`;
      ctx.fillRect(ROAD_LEFT + 7, PLAYER_Y - 4, ROAD_WIDTH - 14, 8);
      ctx.fillStyle = `rgba(255, 255, 255, ${pulse * 0.65})`;
      for (let lane = 0; lane < 5; lane += 1) {
        ctx.fillRect(laneCenter(lane) - 18, PLAYER_Y - 6, 36, 3);
      }

      // Speed lines.
      ctx.fillStyle = "rgba(114, 241, 255, 0.22)";
      for (let i = 0; i < 8; i += 1) {
        const x = ROAD_LEFT + 18 + ((i * 83 + beatRef.current * 17) % (ROAD_WIDTH - 36));
        const y = (roadOffset * 2 + i * 113) % GAME_HEIGHT;
        ctx.fillRect(x, y, 2, 18 + (i % 3) * 8);
      }

      // Pedestrian crossing event.
      const pedestrian = pedestrianRef.current;
      if (pedestrian) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
        for (let x = ROAD_LEFT + 10; x < ROAD_LEFT + ROAD_WIDTH - 10; x += 34) {
          ctx.fillRect(x, pedestrian.y - 42, 21, 8);
          ctx.fillRect(x, pedestrian.y + 36, 21, 8);
        }
        ctx.fillStyle = "rgba(255, 230, 109, 0.12)";
        ctx.fillRect(ROAD_LEFT + 7, pedestrian.y - 48, ROAD_WIDTH - 14, 96);

        ctx.save();
        ctx.translate(Math.round(pedestrian.x), pedestrian.y);
        if (pedestrian.direction === -1) ctx.scale(-1, 1);
        ctx.fillStyle = "#d9d3f5";
        ctx.fillRect(-10, -27, 18, 19);
        ctx.fillStyle = "#f2d0b4";
        ctx.fillRect(-8, -18, 15, 15);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(-5, -17, 4, 4);
        ctx.fillStyle = "#a178ff";
        ctx.fillRect(-12, -6, 23, 27);
        ctx.fillStyle = "#6944c4";
        ctx.fillRect(-16, 13, 31, 11);
        ctx.fillStyle = "#f2d0b4";
        ctx.fillRect(10, -2, 7, 18);
        ctx.fillStyle = "#ffe66d";
        ctx.fillRect(15, 8, 4, 32);
        ctx.fillStyle = "#332757";
        ctx.fillRect(-10, 24, 7, 11);
        ctx.fillRect(6, 24, 7, 11);
        ctx.restore();
      }

      // Entities.
      for (const entity of entitiesRef.current) {
        const x = laneCenter(entity.lane);
        const wobble = Math.sin(elapsed / 160 + entity.wobble) * 3;
        ctx.save();
        ctx.translate(Math.round(x + wobble), Math.round(entity.y));

        if (entity.type === "fan") {
          const timingDistance = Math.abs(entity.hitAt - elapsed);
          if (timingDistance < 260) {
            const ringScale = 1 + timingDistance / 520;
            ctx.strokeStyle =
              timingDistance < 110 ? "#ffe66d" : "rgba(114, 241, 255, 0.82)";
            ctx.lineWidth = timingDistance < 110 ? 5 : 3;
            ctx.beginPath();
            ctx.arc(0, -5, 29 * ringScale, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = timingDistance < 110 ? "#ffe66d" : "#72f1ff";
            ctx.font = "bold 9px monospace";
            ctx.textAlign = "center";
            ctx.fillText(timingDistance < 110 ? "HIT!" : "SPACE", 0, -38);
          }
          ctx.shadowColor = "#72f1ff";
          ctx.shadowBlur = 13;
          ctx.fillStyle = "#72f1ff";
          ctx.fillRect(-6, -21, 12, 26);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(-3, -18, 6, 18);
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#ff4fa3";
          ctx.fillRect(-8, 5, 16, 9);
          ctx.fillStyle = "#ffe66d";
          ctx.fillRect(-4, 8, 8, 3);
          ctx.fillStyle = "rgba(114, 241, 255, 0.25)";
          ctx.fillRect(-13, -26, 26, 35);
        } else if (entity.type === "lucky") {
          ctx.shadowColor = "#ffe66d";
          ctx.shadowBlur = 15;
          ctx.fillStyle = "#8c5bff";
          ctx.fillRect(-18, -17, 36, 34);
          ctx.fillStyle = "#c9a9ff";
          ctx.fillRect(-12, -22, 24, 7);
          ctx.fillStyle = "#ffe66d";
          ctx.fillRect(-4, -9, 8, 14);
          ctx.fillRect(-4, 8, 8, 5);
          ctx.shadowBlur = 0;
          ctx.strokeStyle = "#fff2a8";
          ctx.lineWidth = 3;
          ctx.strokeRect(-18, -17, 36, 34);
        } else if (entity.type === "magnet") {
          ctx.shadowColor = "#72f1ff";
          ctx.shadowBlur = 18;
          ctx.fillStyle = "#16123c";
          ctx.fillRect(-23, -25, 46, 50);
          ctx.strokeStyle = "#72f1ff";
          ctx.lineWidth = 7;
          ctx.lineCap = "square";
          ctx.beginPath();
          ctx.moveTo(-13, -11);
          ctx.lineTo(-13, 5);
          ctx.quadraticCurveTo(0, 20, 13, 5);
          ctx.lineTo(13, -11);
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#ffe66d";
          ctx.fillRect(-18, -18, 10, 9);
          ctx.fillStyle = "#ff4fa3";
          ctx.fillRect(8, -18, 10, 9);
          ctx.strokeStyle = "#bbaaff";
          ctx.lineWidth = 2;
          ctx.strokeRect(-23, -25, 46, 50);
        } else if (entity.type === "invincible") {
          ctx.shadowColor = "#ffe66d";
          ctx.shadowBlur = 19;
          ctx.fillStyle = "#ff4fa3";
          ctx.beginPath();
          ctx.moveTo(0, -29);
          ctx.lineTo(25, -15);
          ctx.lineTo(20, 17);
          ctx.lineTo(0, 29);
          ctx.lineTo(-20, 17);
          ctx.lineTo(-25, -15);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#5a3cc4";
          ctx.beginPath();
          ctx.moveTo(0, -21);
          ctx.lineTo(17, -10);
          ctx.lineTo(13, 12);
          ctx.lineTo(0, 21);
          ctx.lineTo(-13, 12);
          ctx.lineTo(-17, -10);
          ctx.closePath();
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#ffe66d";
          ctx.font = "bold 22px monospace";
          ctx.textAlign = "center";
          ctx.fillText("★", 0, 8);
        } else if (entity.obstacle === "cone") {
          ctx.fillStyle = "rgba(255, 86, 94, 0.2)";
          ctx.fillRect(-23, -22, 46, 44);
          ctx.fillStyle = "#ff6b4a";
          ctx.beginPath();
          ctx.moveTo(0, -23);
          ctx.lineTo(18, 16);
          ctx.lineTo(-18, 16);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#fff4d8";
          ctx.fillRect(-11, -1, 22, 7);
          ctx.fillStyle = "#ff9d4d";
          ctx.fillRect(-24, 16, 48, 8);
        } else if (entity.obstacle === "speaker") {
          ctx.fillStyle = "#35284e";
          ctx.fillRect(-24, -29, 48, 58);
          ctx.strokeStyle = "#ff4fa3";
          ctx.lineWidth = 3;
          ctx.strokeRect(-24, -29, 48, 58);
          ctx.fillStyle = "#0c0c1c";
          ctx.beginPath();
          ctx.arc(0, 11, 13, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#72f1ff";
          ctx.beginPath();
          ctx.arc(0, 11, 6 + pulse * 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#ffe66d";
          ctx.fillRect(-5, -19, 10, 10);
        } else {
          ctx.fillStyle = "#f7f1ff";
          ctx.fillRect(-31, -20, 62, 12);
          ctx.fillRect(-31, 4, 62, 12);
          ctx.fillStyle = "#ff526f";
          for (let i = -28; i < 29; i += 20) {
            ctx.fillRect(i, -20, 10, 12);
            ctx.fillRect(i + 10, 4, 10, 12);
          }
          ctx.fillStyle = "#f5a623";
          ctx.fillRect(-25, 16, 8, 14);
          ctx.fillRect(17, 16, 8, 14);
        }
        ctx.restore();
      }

      // Bus shadow and body.
      const busX = busXRef.current;
      const busY = PLAYER_Y - busBounceRef.current * 18;
      const vehicle = getVehicle(vehicleLevelRef.current);
      const busScale = 1 + (vehicle.level - 1) * 0.015;
      ctx.save();
      ctx.translate(Math.round(busX), Math.round(busY));
      if (elapsed < magnetUntilRef.current) {
        ctx.save();
        ctx.strokeStyle = `rgba(114, 241, 255, ${0.38 + pulse * 0.3})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([9, 7]);
        ctx.beginPath();
        ctx.arc(0, 0, MAGNET_RADIUS + pulse * 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(255, 230, 109, 0.34)";
        ctx.lineWidth = 2;
        for (const fan of entitiesRef.current) {
          if (fan.type !== "fan" || fan.handled) continue;
          const fanX = laneCenter(fan.lane) - busX;
          const fanY = fan.y - busY;
          if (Math.hypot(fanX, fanY) > MAGNET_RADIUS) continue;
          ctx.beginPath();
          ctx.moveTo(0, -8);
          ctx.lineTo(fanX, fanY);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (elapsed < invincibleUntilRef.current) {
        ctx.save();
        ctx.rotate((elapsed / 850) % (Math.PI * 2));
        ["#72f1ff", "#ffe66d", "#ff4fa3"].forEach((color, index) => {
          const radius = 54 + index * 8 + pulse * 3;
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.56 - index * 0.1;
          ctx.lineWidth = 4;
          ctx.strokeRect(-radius, -radius, radius * 2, radius * 2);
        });
        ctx.restore();
      }
      ctx.scale(busScale, busScale);
      ctx.fillStyle = "rgba(0,0,0,0.38)";
      ctx.fillRect(-27, 45, 54, 14);
      if (shieldRef.current) {
        ctx.strokeStyle = `rgba(114, 241, 255, ${0.55 + pulse * 0.35})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 4, 48 + pulse * 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = "#121225";
      ctx.fillRect(-30, -37, 7, 24);
      ctx.fillRect(23, -37, 7, 24);
      ctx.fillRect(-30, 21, 7, 24);
      ctx.fillRect(23, 21, 7, 24);
      ctx.fillStyle = vehicle.primary;
      ctx.fillRect(-26, -52, 52, 105);
      ctx.fillStyle = vehicle.secondary;
      ctx.fillRect(-21, -46, 42, 92);
      ctx.fillStyle = "#2c225e";
      ctx.fillRect(-21, -38, 42, 29);
      ctx.fillStyle = "#72f1ff";
      ctx.fillRect(-17, -34, 14, 18);
      ctx.fillRect(3, -34, 14, 18);
      ctx.fillStyle = "#ffd5aa";
      ctx.fillRect(-13, -29, 6, 7);
      ctx.fillRect(7, -29, 6, 7);
      ctx.fillStyle = "#201740";
      ctx.fillRect(-12, -27, 2, 2);
      ctx.fillRect(8, -27, 2, 2);
      ctx.fillStyle = "#ffe66d";
      ctx.font = "bold 23px monospace";
      ctx.textAlign = "center";
      ctx.fillText("★", 0, 24);
      ctx.fillStyle = "#fff7bd";
      ctx.fillRect(-22, 40, 14, 7);
      ctx.fillRect(8, 40, 14, 7);
      ctx.fillStyle = "#ff285f";
      ctx.fillRect(-20, -50, 12, 5);
      ctx.fillRect(8, -50, 12, 5);
      for (let light = 0; light < vehicle.level; light += 1) {
        ctx.fillStyle = light % 2 === 0 ? "#72f1ff" : "#ffe66d";
        ctx.fillRect(-22 + light * 12, -59, 8, 6);
      }
      ctx.restore();

      // Particles and score text.
      for (const particle of particlesRef.current) {
        ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
        ctx.fillStyle = particle.color;
        ctx.fillRect(
          Math.round(particle.x),
          Math.round(particle.y),
          Math.ceil(particle.size),
          Math.ceil(particle.size),
        );
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "center";
      ctx.font = "bold 18px monospace";
      for (const item of floatTextRef.current) {
        ctx.globalAlpha = Math.max(0, item.life / item.maxLife);
        ctx.fillStyle = "#0b0920";
        ctx.fillText(item.text, item.x + 2, item.y + 2);
        ctx.fillStyle = item.color;
        ctx.fillText(item.text, item.x, item.y);
      }
      ctx.globalAlpha = 1;

      if (hitFlashRef.current > 0) {
        ctx.fillStyle = `rgba(255, 40, 95, ${hitFlashRef.current * 0.38})`;
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      }
      if (collectFlashRef.current > 0) {
        ctx.fillStyle = `rgba(114, 241, 255, ${collectFlashRef.current * 0.16})`;
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      }
      ctx.restore();
    },
    [],
  );

  const finishGame = useCallback(() => {
    if (statusRef.current !== "playing") return;
    statusRef.current = "finished";
    setStatus("finished");
    setProgress(100);

    const tier = getConcertTier(fansRef.current, maxComboRef.current);
    const coins = tier.coins + maxComboRef.current * 3;
    setEarnedCoins(coins);
    setResultTier(tier);
    setFans(fansRef.current);
    setCombo(comboRef.current);
    setMaxCombo(maxComboRef.current);

    const previousCoins = Number(window.localStorage.getItem("fan-bus-coins") || 0);
    const previousBest = Number(window.localStorage.getItem("fan-bus-best") || 0);
    const nextCoins = previousCoins + coins;
    const nextBest = Math.max(previousBest, fansRef.current);
    window.localStorage.setItem("fan-bus-coins", String(nextCoins));
    window.localStorage.setItem("fan-bus-best", String(nextBest));
    setBankCoins(nextCoins);
    setBestFans(nextBest);

    const playerId = playerIdRef.current;
    if (playerId) {
      void fetch("/api/leaderboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId,
          name: playerNameRef.current.trim() || "巡演玩家",
          fans: fansRef.current,
          maxCombo: maxComboRef.current,
          song: trackRef.current.name,
        }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Leaderboard sync failed");
          const payload = (await response.json()) as {
            leaderboard?: LeaderboardEntry[];
            disabled?: boolean;
          };
          // A deploy without leaderboard storage is not a sync failure, so stay
          // silent instead of nagging after every run.
          if (payload.disabled) return;
          if (payload.leaderboard) {
            setLeaderboard(payload.leaderboard);
            setCurrentRankEntryId(playerId);
          }
        })
        .catch(() => {
          showToast("全局排行榜同步失败，请稍后重试", "danger");
        });
    }

    addBurst(GAME_WIDTH / 2, PLAYER_Y - 120, tier.color, 38);
    if (songRef.current) {
      songRef.current.pause();
    }
    magnetUntilRef.current = -1;
    invincibleUntilRef.current = -1;
    setMagnetRemaining(0);
    setInvincibleRemaining(0);
    resetSongTone();
  }, [addBurst, resetSongTone, showToast]);

  const failGame = useCallback(() => {
    if (statusRef.current !== "playing") return;
    statusRef.current = "failed";
    setStatus("failed");
    setEarnedCoins(0);
    setCurrentRankEntryId(null);
    setProgress(100);
    shakeRef.current = 0.7;
    hitFlashRef.current = 1;
    addBurst(busXRef.current, PLAYER_Y - 8, "#ffe66d", 34);
    if (songRef.current) {
      songRef.current.pause();
    }
    magnetUntilRef.current = -1;
    invincibleUntilRef.current = -1;
    setMagnetRemaining(0);
    setInvincibleRemaining(0);
    resetSongTone();

    const audio = audioRef.current;
    if (audio && !mutedRef.current) {
      const now = audio.currentTime;
      const brake = audio.createOscillator();
      const brakeGain = audio.createGain();
      brake.type = "sawtooth";
      brake.frequency.setValueAtTime(620, now);
      brake.frequency.exponentialRampToValueAtTime(55, now + 0.42);
      brakeGain.gain.setValueAtTime(0.12, now);
      brakeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
      brake.connect(brakeGain).connect(audio.destination);
      brake.start(now);
      brake.stop(now + 0.46);
    }
  }, [addBurst, resetSongTone]);

  const gameLoop = useCallback(
    function gameLoopFrame(now: number) {
      if (statusRef.current !== "playing") return;
      const delta = Math.min(0.035, Math.max(0, (now - lastTimeRef.current) / 1000));
      lastTimeRef.current = now;
      const elapsed =
        songRef.current && !songRef.current.paused
          ? songRef.current.currentTime * 1000
          : now - startTimeRef.current;
      const track = trackRef.current;
      const beatTimes = beatTimesRef.current;

      while (
        nextBeatRef.current < track.totalBeats &&
        elapsed >= beatTimes[nextBeatRef.current]
      ) {
        const beat = nextBeatRef.current;
        beatRef.current = beat;
        beatPulseRef.current = 1;
        setCurrentBpm(track.bpmAt(beat));
        playBeat(beat);
        spawnBeat(beat);

        if (beat === track.grannyBeat - 4 && !grannyWarnedRef.current) {
          grannyWarnedRef.current = true;
          pedestrianRef.current = {
            startAt: beatTimes[beat],
            hitAt: beatTimes[track.grannyBeat],
            endAt:
              beatTimes[
                Math.min(track.grannyBeat + 4, beatTimes.length - 1)
              ],
            direction: track.grannyBeat % 2 === 0 ? 1 : -1,
            x:
              track.grannyBeat % 2 === 0
                ? ROAD_LEFT - 24
                : ROAD_LEFT + ROAD_WIDTH + 24,
            y: -70,
          };
          showToast("注意！4 拍后行人抵达中间车道", "gold");
        }
        if (beat === track.grannyBeat) {
          showToast("危险！离开中间车道", "danger");
        }
        if (
          arrangementUntilRef.current > 0 &&
          beat >= arrangementUntilRef.current
        ) {
          resetSongTone();
          showToast("伴奏音色恢复 · 节奏始终不变", "cyan");
        }

        nextBeatRef.current += 1;
        setBeatIndex(beat);
      }

      busXRef.current +=
        (laneCenter(laneRef.current) - busXRef.current) * Math.min(1, delta * 14);

      if (
        magnetUntilRef.current > 0 &&
        elapsed >= magnetUntilRef.current
      ) {
        magnetUntilRef.current = -1;
        setMagnetRemaining(0);
        showToast("磁铁效果结束", "cyan");
      }
      if (
        invincibleUntilRef.current > 0 &&
        elapsed >= invincibleUntilRef.current
      ) {
        invincibleUntilRef.current = -1;
        setInvincibleRemaining(0);
        showToast("无敌模式结束", "gold");
      }

      const nextEntities: Entity[] = [];
      for (const currentEntity of entitiesRef.current) {
        const travelProgress =
          (elapsed - currentEntity.spawnAt) /
          Math.max(1, currentEntity.hitAt - currentEntity.spawnAt);
        const entity: Entity = {
          ...currentEntity,
          y: -70 + (PLAYER_Y + 70) * travelProgress,
        };

        if (entity.type === "fan") {
          const magnetDistance = Math.hypot(
            laneCenter(entity.lane) - busXRef.current,
            entity.y - PLAYER_Y,
          );
          if (
            !entity.handled &&
            elapsed < magnetUntilRef.current &&
            magnetDistance <= MAGNET_RADIUS
          ) {
            entity.handled = true;
            currentEntity.handled = true;
            comboRef.current += 1;
            maxComboRef.current = Math.max(
              maxComboRef.current,
              comboRef.current,
            );
            perfectCountRef.current += 1;
            successfulHitsRef.current += 1;
            setCombo(comboRef.current);
            setMaxCombo(maxComboRef.current);
            setSuccessfulHits(successfulHitsRef.current);
            const upgraded = checkVehicleUpgrade();
            const capacity = getVehicle(vehicleLevelRef.current).capacity;
            const fanGained = fansRef.current < capacity;
            fansRef.current = Math.min(capacity, fansRef.current + 1);
            setFans(fansRef.current);
            if (!upgraded) {
              showJudgement(
                "PERFECT",
                fanGained
                  ? `MAGNET PERFECT · +1 FAN · ×${comboRef.current}`
                  : `MAGNET PERFECT · BUS FULL ${capacity} · ×${comboRef.current}`,
              );
            }
            addBurst(
              laneCenter(entity.lane),
              entity.y,
              "#ffe66d",
              24,
            );
            addFloatText(
              laneCenter(entity.lane),
              entity.y - 18,
              fanGained ? "PERFECT +1" : `PERFECT · 满载 ${capacity}`,
              "#ffe66d",
            );
            playFanHit(entity.targetBeat);
            beatPulseRef.current = 1.45;
            collectFlashRef.current = 1;
            busBounceRef.current = 0.8;
            screenPunchRef.current = 0.75;
            navigator.vibrate?.([14, 10, 20]);
            if (
              perfectCountRef.current % 8 === 0 &&
              !shieldRef.current
            ) {
              shieldRef.current = true;
              setShield(true);
              showToast("8 次 PERFECT！获得应援护盾", "gold");
            }
            continue;
          }
          if (!entity.handled && elapsed > entity.hitAt + MISS_WINDOW) {
            entity.handled = true;
            comboRef.current = 0;
            setCombo(0);
            showJudgement("MISS", "节拍漏击 · COMBO BREAK");
            addFloatText(
              laneCenter(entity.lane),
              PLAYER_Y - 54,
              "MISS",
              "#ff526f",
            );
            hitFlashRef.current = 0.32;
          }
          if (!entity.handled && entity.y < GAME_HEIGHT + 90) {
            nextEntities.push(entity);
          }
          continue;
        }

        const colliding =
          !entity.handled &&
          entity.lane === laneRef.current &&
          entity.y > PLAYER_Y - OBSTACLE_COLLISION_BEFORE &&
          entity.y < PLAYER_Y + OBSTACLE_COLLISION_AFTER;

        if (!colliding) {
          if (!entity.handled && entity.y < GAME_HEIGHT + 90) {
            nextEntities.push(entity);
          }
          continue;
        }

        const x = laneCenter(entity.lane);
        if (entity.type === "lucky") {
          entity.handled = true;
          currentEntity.handled = true;
          entitiesRef.current = entitiesRef.current.filter(
            (item) => item.id !== entity.id,
          );
          statusRef.current = "lucky";
          setStatus("lucky");
          setLuckyDialog({ phase: "choice" });
          setNoteJudgement(null);
          songRef.current?.pause();
          void audioRef.current?.suspend();
          animationRef.current = null;
          return;
        } else if (entity.type === "magnet") {
          entity.handled = true;
          currentEntity.handled = true;
          magnetUntilRef.current = elapsed + POWERUP_DURATION_MS;
          setMagnetRemaining(POWERUP_DURATION_MS);
          collectFlashRef.current = 1.3;
          busBounceRef.current = 1.15;
          addBurst(x, PLAYER_Y - 10, "#72f1ff", 30);
          addFloatText(x, PLAYER_Y - 66, "磁铁 5 秒", "#72f1ff");
          showToast("获得磁铁！5 秒内附近应援棒自动 PERFECT", "cyan");
          navigator.vibrate?.([24, 15, 32]);
        } else if (entity.type === "invincible") {
          entity.handled = true;
          currentEntity.handled = true;
          invincibleUntilRef.current = elapsed + POWERUP_DURATION_MS;
          setInvincibleRemaining(POWERUP_DURATION_MS);
          collectFlashRef.current = 1.3;
          screenPunchRef.current = 1.1;
          addBurst(x, PLAYER_Y - 10, "#ffe66d", 34);
          addFloatText(x, PLAYER_Y - 66, "无敌 5 秒", "#ffe66d");
          showToast("进入无敌模式！5 秒内无视所有障碍", "gold");
          navigator.vibrate?.([30, 16, 45]);
        } else {
          entity.handled = true;
          if (elapsed < invincibleUntilRef.current) {
            addBurst(x, PLAYER_Y, "#ffe66d", 18);
            addFloatText(x, PLAYER_Y - 58, "无敌穿越!", "#ffe66d");
            screenPunchRef.current = 0.45;
            navigator.vibrate?.(16);
            continue;
          }
          if (now < invulnerableUntilRef.current) continue;
          invulnerableUntilRef.current = now + 720;
          const baseLoss =
            entity.obstacle === "barrier"
              ? 10
              : entity.obstacle === "speaker"
                ? 7
                : 4;
          const loss = shieldRef.current ? Math.ceil(baseLoss / 2) : baseLoss;
          if (shieldRef.current) {
            shieldRef.current = false;
            setShield(false);
            addFloatText(x, PLAYER_Y - 82, "护盾减伤", "#72f1ff");
          }
          const actualLoss = Math.min(fansRef.current, loss);
          fansRef.current -= actualLoss;
          comboRef.current = 0;
          setFans(fansRef.current);
          setCombo(0);
          shakeRef.current = 0.34;
          hitFlashRef.current = 1;
          triggerDamageVariation();
          addBurst(x, PLAYER_Y, "#ff375f", 17);
          addFloatText(x, PLAYER_Y - 58, `-${actualLoss} 粉丝`, "#ff526f");
          showToast(
            `掉粉 -${actualLoss} · 音色变${toneModeRef.current === "thick" ? "厚" : "细"} 8 拍`,
            "danger",
          );
        }
      }

      entitiesRef.current = nextEntities;

      const pedestrian = pedestrianRef.current;
      if (pedestrian) {
        const crossingProgress =
          (elapsed - pedestrian.startAt) /
          Math.max(1, pedestrian.endAt - pedestrian.startAt);
        const approachProgress =
          (elapsed - pedestrian.startAt) /
          Math.max(1, pedestrian.hitAt - pedestrian.startAt);
        const fromX =
          pedestrian.direction === 1 ? ROAD_LEFT - 24 : ROAD_LEFT + ROAD_WIDTH + 24;
        const toX =
          pedestrian.direction === 1 ? ROAD_LEFT + ROAD_WIDTH + 24 : ROAD_LEFT - 24;
        const pedestrianX = fromX + (toX - fromX) * crossingProgress;
        const pedestrianY = -70 + (PLAYER_Y + 70) * approachProgress;
        pedestrianRef.current = {
          ...pedestrian,
          x: pedestrianX,
          y: pedestrianY,
        };

        if (
          crossingProgress >= 0 &&
          crossingProgress <= 1 &&
          Math.abs(pedestrianY - PLAYER_Y) < 48 &&
          Math.abs(pedestrianX - busXRef.current) < 36
        ) {
          failGame();
          return;
        }
        if (crossingProgress > 1.05 || pedestrianY > GAME_HEIGHT + 80) {
          pedestrianRef.current = null;
          showToast("行人已安全通过", "cyan");
        }
      }

      particlesRef.current = particlesRef.current
        .map((particle) => ({
          ...particle,
          x: particle.x + particle.vx * delta,
          y: particle.y + particle.vy * delta,
          vy: particle.vy + 115 * delta,
          life: particle.life - delta,
        }))
        .filter((item) => item.life > 0);

      floatTextRef.current = floatTextRef.current
        .map((item) => ({
          ...item,
          y: item.y - 38 * delta,
          life: item.life - delta,
        }))
        .filter((item) => item.life > 0);

      beatPulseRef.current = Math.max(0, beatPulseRef.current - delta * 4.6);
      shakeRef.current = Math.max(0, shakeRef.current - delta);
      hitFlashRef.current = Math.max(0, hitFlashRef.current - delta * 3.4);
      collectFlashRef.current = Math.max(
        0,
        collectFlashRef.current - delta * 5.8,
      );
      busBounceRef.current = Math.max(0, busBounceRef.current - delta * 5.2);
      screenPunchRef.current = Math.max(
        0,
        screenPunchRef.current - delta * 7,
      );

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (ctx) drawGame(ctx, elapsed);

      if (elapsed - lastHudRef.current > 100) {
        lastHudRef.current = elapsed;
        setMagnetRemaining(
          Math.max(0, magnetUntilRef.current - elapsed),
        );
        setInvincibleRemaining(
          Math.max(0, invincibleUntilRef.current - elapsed),
        );
        setProgress(
          Math.min(100, (elapsed / beatTimes[track.totalBeats]) * 100),
        );
      }

      if (
        elapsed >= beatTimes[track.totalBeats] ||
        (songRef.current?.ended ?? false)
      ) {
        finishGame();
        return;
      }

      animationRef.current = window.requestAnimationFrame(gameLoopFrame);
    },
    [
      addBurst,
      addFloatText,
      checkVehicleUpgrade,
      drawGame,
      failGame,
      finishGame,
      playBeat,
      playFanHit,
      resetSongTone,
      showJudgement,
      showToast,
      spawnBeat,
      triggerDamageVariation,
    ],
  );

  const hitNote = useCallback(() => {
    if (statusRef.current !== "playing") return;
    const inputAt = performance.now();
    if (inputAt - lastHitInputAtRef.current < HIT_INPUT_GUARD_MS) return;
    lastHitInputAtRef.current = inputAt;
    const elapsed =
      songRef.current && !songRef.current.paused
        ? songRef.current.currentTime * 1000
        : performance.now() - startTimeRef.current;
    const candidate = entitiesRef.current
      .filter(
        (entity) =>
          entity.type === "fan" &&
          !entity.handled &&
          entity.lane === laneRef.current &&
          Math.abs(elapsed - entity.hitAt) <= MISS_WINDOW,
      )
      .sort(
        (first, second) =>
          Math.abs(elapsed - first.hitAt) - Math.abs(elapsed - second.hitAt),
      )[0];

    if (!candidate) {
      if (elapsed < magnetUntilRef.current) {
        // The magnet already judges a fan when that entity is actually
        // absorbed. Empty HIT presses must not create extra PERFECT feedback.
        return;
      }
      comboRef.current = 0;
      setCombo(0);
      showJudgement("MISS", "不在节拍点或车道错误");
      addFloatText(busXRef.current, PLAYER_Y - 72, "MISS", "#ff526f");
      hitFlashRef.current = 0.34;
      navigator.vibrate?.(12);
      return;
    }

    candidate.handled = true;
    const timingError = Math.abs(elapsed - candidate.hitAt);
    const quality: NoteJudgement["quality"] =
      timingError <= 55
        ? "PERFECT"
        : timingError <= 110
          ? "GREAT"
          : "GOOD";
    comboRef.current += 1;
    maxComboRef.current = Math.max(maxComboRef.current, comboRef.current);
    if (quality === "PERFECT") perfectCountRef.current += 1;
    successfulHitsRef.current += 1;
    setSuccessfulHits(successfulHitsRef.current);
    const upgraded = checkVehicleUpgrade();
    const capacity = getVehicle(vehicleLevelRef.current).capacity;
    const fanGained = fansRef.current < capacity;
    fansRef.current = Math.min(capacity, fansRef.current + 1);
    setFans(fansRef.current);
    setCombo(comboRef.current);
    setMaxCombo(maxComboRef.current);
    if (!upgraded) {
      showJudgement(
        quality,
        fanGained
          ? `JUST HIT · +1 FAN · ×${comboRef.current}`
          : `JUST HIT · BUS FULL ${capacity} · ×${comboRef.current}`,
      );
    }
    playFanHit(candidate.targetBeat);

    const x = laneCenter(candidate.lane);
    addBurst(x, PLAYER_Y - 22, "#72f1ff", 28);
    if (quality === "PERFECT") addBurst(x, PLAYER_Y - 22, "#ffe66d", 20);
    addFloatText(
      x,
      PLAYER_Y - 64,
      fanGained
        ? quality === "PERFECT"
          ? "点上了! +1"
          : "+1 FAN"
        : `满载 ${capacity}`,
      quality === "PERFECT" ? "#ffe66d" : "#ffffff",
    );
    beatPulseRef.current = 1.65;
    collectFlashRef.current = 1;
    busBounceRef.current = 1;
    screenPunchRef.current = quality === "PERFECT" ? 1.2 : 0.72;
    navigator.vibrate?.(quality === "PERFECT" ? [18, 16, 28] : 22);

    if (
      quality === "PERFECT" &&
      perfectCountRef.current % 8 === 0 &&
      !shieldRef.current
    ) {
      shieldRef.current = true;
      setShield(true);
      showToast("8 次 PERFECT！获得应援护盾", "gold");
    }
  }, [
    addBurst,
    addFloatText,
    checkVehicleUpgrade,
    playFanHit,
    showJudgement,
    showToast,
  ]);

  const startGame = useCallback(async () => {
    const song = songRef.current;
    const analysedBeats = detectedBeatTimesRef.current;
    if (!playerNameRef.current.trim()) {
      showToast("请先填写排行榜昵称", "pink");
      return;
    }
    if (!songReady || !song || analysedBeats.length < 12) {
      showToast("请先选择一首歌曲", "pink");
      return;
    }
    if (animationRef.current) {
      window.cancelAnimationFrame(animationRef.current);
    }

    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!audioRef.current || audioRef.current.state === "closed") {
      audioRef.current = AudioContextClass ? new AudioContextClass() : null;
      mediaSourceRef.current = null;
      lowShelfRef.current = null;
      highShelfRef.current = null;
    }
    const audio = audioRef.current;
    if (audio && !mediaSourceRef.current) {
      const mediaSource = audio.createMediaElementSource(song);
      const lowShelf = audio.createBiquadFilter();
      const highShelf = audio.createBiquadFilter();
      lowShelf.type = "lowshelf";
      lowShelf.frequency.value = 320;
      lowShelf.gain.value = 0;
      highShelf.type = "highshelf";
      highShelf.frequency.value = 1900;
      highShelf.gain.value = 0;
      mediaSource.connect(lowShelf).connect(highShelf).connect(audio.destination);
      mediaSourceRef.current = mediaSource;
      lowShelfRef.current = lowShelf;
      highShelfRef.current = highShelf;
    }

    const totalBeats = analysedBeats.length - 1;
    const runtimeTrack: Track = {
      ...selectedTrack,
      name: songTitle,
      english: songTitle,
      totalBeats,
      grannyBeat: Math.max(8, Math.min(totalBeats - 6, Math.floor(totalBeats * 0.56))),
      tempoLabel: `${detectedBpmRef.current} BPM`,
      bpmAt: () => detectedBpmRef.current,
      lanePattern: detectedLanePatternRef.current,
      notePattern: detectedNotePatternRef.current,
      intensityPattern: detectedIntensityPatternRef.current,
    };
    trackRef.current = runtimeTrack;
    beatTimesRef.current = analysedBeats;
    window.localStorage.setItem("fan-bus-track", runtimeTrack.id);
    statusRef.current = "playing";
    setStatus("playing");
    laneRef.current = 2;
    busXRef.current = laneCenter(2);
    vehicleLevelRef.current = 1;
    fansRef.current = STARTING_FANS;
    comboRef.current = 0;
    maxComboRef.current = 0;
    beatRef.current = 0;
    nextBeatRef.current = 0;
    entityIdRef.current = 0;
    lastObstacleTargetBeatRef.current = -Infinity;
    entitiesRef.current = [];
    particlesRef.current = [];
    floatTextRef.current = [];
    pedestrianRef.current = null;
    shieldRef.current = false;
    perfectCountRef.current = 0;
    successfulHitsRef.current = 0;
    magnetUntilRef.current = -1;
    invincibleUntilRef.current = -1;
    grannyWarnedRef.current = false;
    invulnerableUntilRef.current = 0;
    lastHitInputAtRef.current = -Infinity;
    beatPulseRef.current = 0;
    shakeRef.current = 0;
    hitFlashRef.current = 0;
    collectFlashRef.current = 0;
    busBounceRef.current = 0;
    screenPunchRef.current = 0;
    setFans(STARTING_FANS);
    setVehicleLevel(1);
    setCombo(0);
    setMaxCombo(0);
    setSuccessfulHits(0);
    setMagnetRemaining(0);
    setInvincibleRemaining(0);
    setProgress(0);
    setShield(false);
    setCurrentBpm(detectedBpmRef.current);
    setToast(null);
    setNoteJudgement(null);
    setLuckyDialog(null);
    setCurrentRankEntryId(null);
    resetSongTone();

    song.pause();
    song.currentTime = 0;
    song.playbackRate = 1;
    song.muted = mutedRef.current;
    try {
      await audio?.resume();
      await song.play();
    } catch {
      statusRef.current = "ready";
      setStatus("ready");
      setSongError("浏览器未能播放该音频，请重新导入后再试");
      showToast("音频播放失败", "danger");
      return;
    }

    const now = performance.now();
    startTimeRef.current = now;
    lastTimeRef.current = now;
    lastHudRef.current = 0;
    animationRef.current = window.requestAnimationFrame(gameLoop);
  }, [
    gameLoop,
    resetSongTone,
    selectedTrack,
    showToast,
    songReady,
    songTitle,
  ]);

  const pauseGame = useCallback(() => {
    if (statusRef.current !== "playing") return;
    statusRef.current = "paused";
    setStatus("paused");
    if (animationRef.current) {
      window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    songRef.current?.pause();
    void audioRef.current?.suspend();
    setNoteJudgement(null);
  }, []);

  const resumeGame = useCallback(async () => {
    if (statusRef.current !== "paused" || !songRef.current) return;
    statusRef.current = "playing";
    setStatus("playing");
    try {
      await audioRef.current?.resume();
      await songRef.current.play();
      lastTimeRef.current = performance.now();
      animationRef.current = window.requestAnimationFrame(gameLoop);
    } catch {
      statusRef.current = "paused";
      setStatus("paused");
      showToast("歌曲继续播放失败，请重新发车", "danger");
    }
  }, [gameLoop, showToast]);

  const openLuckyBag = useCallback(() => {
    if (
      statusRef.current !== "lucky" ||
      !luckyDialog ||
      luckyDialog.phase !== "choice"
    ) {
      return;
    }

    const before = fansRef.current;
    const capacity = getVehicle(vehicleLevelRef.current).capacity;
    const doubled = Math.random() < 0.55;
    if (doubled) {
      const doubledFans = before * 2;
      fansRef.current = Math.min(capacity, doubledFans);
      addFloatText(
        busXRef.current,
        PLAYER_Y - 64,
        doubledFans > capacity ? `翻倍！上限 ${capacity}` : "粉丝 ×2!",
        "#ffe66d",
      );
      addBurst(busXRef.current, PLAYER_Y - 10, "#ffe66d", 28);
      collectFlashRef.current = 1.4;
      screenPunchRef.current = 1.1;
      setLuckyDialog({
        phase: "result",
        outcome: "double",
        before,
        after: fansRef.current,
        capacity,
        capped: doubledFans > capacity,
      });
      navigator.vibrate?.([24, 18, 38]);
    } else {
      fansRef.current = Math.max(1, Math.floor(before / 2));
      comboRef.current = 0;
      setCombo(0);
      addFloatText(
        busXRef.current,
        PLAYER_Y - 64,
        "粉丝 ÷2",
        "#ff7ac8",
      );
      addBurst(busXRef.current, PLAYER_Y - 10, "#ff7ac8", 22);
      hitFlashRef.current = 0.7;
      shakeRef.current = 0.22;
      setLuckyDialog({
        phase: "result",
        outcome: "half",
        before,
        after: fansRef.current,
        capacity,
        capped: false,
      });
      navigator.vibrate?.([45, 25, 45]);
    }
    setFans(fansRef.current);
  }, [addBurst, addFloatText, luckyDialog]);

  const continueLuckyGame = useCallback(async () => {
    if (statusRef.current !== "lucky" || !songRef.current) return;
    statusRef.current = "playing";
    setStatus("playing");
    try {
      await audioRef.current?.resume();
      await songRef.current.play();
      setLuckyDialog(null);
      lastTimeRef.current = performance.now();
      animationRef.current = window.requestAnimationFrame(gameLoop);
    } catch {
      statusRef.current = "lucky";
      setStatus("lucky");
      showToast("歌曲继续播放失败，请重新发车", "danger");
    }
  }, [gameLoop, showToast]);

  const move = useCallback(
    (direction: -1 | 1) => {
      if (statusRef.current !== "playing") return;
      const nextLane = clampLane(laneRef.current + direction);
      if (nextLane === laneRef.current) return;
      laneRef.current = nextLane;
      addBurst(laneCenter(nextLane), PLAYER_Y + 32, "#72f1ff", 4);
    },
    [addBurst],
  );

  const stopJoystick = useCallback(() => {
    if (joystickRepeatRef.current !== null) {
      window.clearInterval(joystickRepeatRef.current);
      joystickRepeatRef.current = null;
    }
    joystickPointerRef.current = null;
    joystickDirectionRef.current = 0;
    setJoystickOffset(0);
  }, []);

  const steerWithJoystick = useCallback(
    (direction: -1 | 0 | 1) => {
      if (
        direction === joystickDirectionRef.current ||
        statusRef.current !== "playing"
      ) {
        return;
      }
      if (joystickRepeatRef.current !== null) {
        window.clearInterval(joystickRepeatRef.current);
        joystickRepeatRef.current = null;
      }
      joystickDirectionRef.current = direction;
      if (direction === 0) return;
      move(direction);
      joystickRepeatRef.current = window.setInterval(() => {
        move(direction);
      }, 135);
    },
    [move],
  );

  const updateJoystick = useCallback(
    (clientX: number, target: HTMLElement) => {
      const bounds = target.getBoundingClientRect();
      const rawOffset = clientX - (bounds.left + bounds.width / 2);
      const nextOffset = Math.max(-34, Math.min(34, rawOffset));
      setJoystickOffset(nextOffset);
      steerWithJoystick(
        nextOffset < -12 ? -1 : nextOffset > 12 ? 1 : 0,
      );
    },
    [steerWithJoystick],
  );

  const returnToSongSelect = useCallback(() => {
    if (animationRef.current) {
      window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (songRef.current) {
      songRef.current.pause();
      songRef.current.currentTime = 0;
    }
    resetSongTone();
    statusRef.current = "ready";
    setStatus("ready");
    setReadyPage("songs");
    laneRef.current = 2;
    busXRef.current = laneCenter(2);
    vehicleLevelRef.current = 1;
    fansRef.current = STARTING_FANS;
    comboRef.current = 0;
    maxComboRef.current = 0;
    successfulHitsRef.current = 0;
    perfectCountRef.current = 0;
    lastHitInputAtRef.current = -Infinity;
    shieldRef.current = false;
    magnetUntilRef.current = -1;
    invincibleUntilRef.current = -1;
    setVehicleLevel(1);
    setFans(STARTING_FANS);
    setCombo(0);
    setMaxCombo(0);
    setSuccessfulHits(0);
    setMagnetRemaining(0);
    setInvincibleRemaining(0);
    setShield(false);
    setProgress(0);
    setToast(null);
    setNoteJudgement(null);
    setLuckyDialog(null);
    setCurrentRankEntryId(null);
    entitiesRef.current = [];
    lastObstacleTargetBeatRef.current = -Infinity;
    pedestrianRef.current = null;
    stopJoystick();
  }, [resetSongTone, stopJoystick]);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    if (songRef.current) songRef.current.muted = mutedRef.current;
    setMuted(mutedRef.current);
  }, []);

  useEffect(() => {
    void loadBuiltInTrack("guaihuo");
  }, [loadBuiltInTrack]);

  useEffect(() => {
    const savedBest = Number(window.localStorage.getItem("fan-bus-best") || 0);
    const savedCoins = Number(window.localStorage.getItem("fan-bus-coins") || 0);
    const storedPlayerName =
      window.localStorage.getItem("fan-bus-player-name") || "";
    const savedPlayerName =
      storedPlayerName === "巡演玩家" ? "" : storedPlayerName;
    let savedPlayerId = window.localStorage.getItem("fan-bus-player-id");
    if (!savedPlayerId) {
      savedPlayerId =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      window.localStorage.setItem("fan-bus-player-id", savedPlayerId);
    }
    playerIdRef.current = savedPlayerId;
    let cancelled = false;
    void fetch("/api/leaderboard")
      .then(async (response) => {
        if (!response.ok) throw new Error("Leaderboard load failed");
        const payload = (await response.json()) as {
          leaderboard?: LeaderboardEntry[];
        };
        if (!cancelled && payload.leaderboard) {
          setLeaderboard(payload.leaderboard);
        }
      })
      .catch(() => {
        if (!cancelled) setLeaderboard([]);
      });
    window.localStorage.removeItem("fan-bus-vehicle-level");
    const savedScoreTimer = window.setTimeout(() => {
      setBestFans(savedBest);
      setBankCoins(savedCoins);
      playerNameRef.current = savedPlayerName;
      setPlayerName(savedPlayerName);
      vehicleLevelRef.current = 1;
      setVehicleLevel(1);
    }, 0);

    const keydown = (event: KeyboardEvent) => {
      if (
        [
          "ArrowLeft",
          "ArrowRight",
          " ",
          "a",
          "A",
          "d",
          "D",
          "p",
          "P",
          "Escape",
        ].includes(event.key)
      ) {
        event.preventDefault();
      }
      const isPauseKey =
        event.key === "p" || event.key === "P" || event.key === "Escape";
      if (event.repeat && (event.key === " " || isPauseKey)) return;
      if (isPauseKey && statusRef.current === "playing") {
        pauseGame();
      } else if (isPauseKey && statusRef.current === "paused") {
        void resumeGame();
      } else if (
        event.key === "ArrowLeft" ||
        event.key === "a" ||
        event.key === "A"
      ) {
        move(-1);
      } else if (
        event.key === "ArrowRight" ||
        event.key === "d" ||
        event.key === "D"
      ) {
        move(1);
      } else if (event.key === "m" || event.key === "M") {
        toggleMute();
      } else if (event.key === " " && statusRef.current === "playing") {
        hitNote();
      } else if (
        event.key === " " &&
        ["ready", "finished", "failed"].includes(statusRef.current)
      ) {
        if (statusRef.current === "ready" && readyPage === "rules") {
          setReadyPage("songs");
        } else {
          void startGame();
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      cancelled = true;
      window.clearTimeout(savedScoreTimer);
      window.removeEventListener("keydown", keydown);
    };
  }, [
    hitNote,
    move,
    pauseGame,
    readyPage,
    resumeGame,
    startGame,
    toggleMute,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx) drawGame(ctx, 0);
    return () => {
      if (animationRef.current) {
        window.cancelAnimationFrame(animationRef.current);
      }
      if (audioRef.current) {
        void audioRef.current.close();
        audioRef.current = null;
      }
      mediaSourceRef.current = null;
      lowShelfRef.current = null;
      highShelfRef.current = null;
      if (songRef.current) {
        songRef.current.pause();
        songRef.current = null;
      }
      if (songUrlRef.current) {
        URL.revokeObjectURL(songUrlRef.current);
        songUrlRef.current = null;
      }
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (judgementTimerRef.current) {
        window.clearTimeout(judgementTimerRef.current);
      }
      stopJoystick();
    };
  }, [drawGame, stopJoystick]);

  useEffect(() => {
    if (status !== "playing") stopJoystick();
  }, [status, stopJoystick]);

  return (
    <main className="arcade-page">
      <div className="sky-grid" aria-hidden="true" />
      <header className="topbar">
        <div className="brand">
          <span className="brand-kicker">
            PIXEL TOUR /{" "}
            {status === "playing" || status === "paused" || status === "lucky"
              ? currentBpm
              : songReady
                ? detectedBpm
                : "--"}{" "}
            BPM
          </span>
          <span className="brand-title">应援大巴冲冲冲！</span>
        </div>
        <div className="meta-strip" aria-label="游戏记录">
          <span>
            <small>BEST</small>
            {bestFans} 粉丝
          </span>
          <span>
            <small>BANK</small>
            <b className="coin-dot">●</b> {bankCoins}
          </span>
          <button
            className="sound-button"
            onClick={toggleMute}
            aria-label={muted ? "打开声音" : "关闭声音"}
          >
            {muted ? "SOUND OFF" : "SOUND ON"}
          </button>
        </div>
      </header>

      <section className="game-layout">
        <div className="game-cabinet">
          <div className="cabinet-top">
            <div>
              <span className="live-dot" />
              {status === "playing" ||
              status === "paused" ||
              status === "lucky"
                ? songTitle
                : "SELECT A TRACK"}
            </div>
            <div className="cabinet-tools">
              <button
                className={`pause-toggle ${status === "paused" ? "is-paused" : ""}`}
                onClick={() =>
                  status === "paused" ? void resumeGame() : pauseGame()
                }
                disabled={status !== "playing" && status !== "paused"}
                aria-label={status === "paused" ? "继续游戏" : "暂停游戏"}
                aria-pressed={status === "paused"}
              >
                {status === "paused" ? "▶ CONTINUE" : "Ⅱ PAUSE"}
              </button>
              <div className="bpm-bars" aria-hidden="true">
                {[0, 1, 2, 3].map((bar) => (
                  <i
                    key={bar}
                    className={
                      beatIndex % 4 === bar && status === "playing"
                        ? "active"
                        : ""
                    }
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="hud">
            <div className="hud-block">
              <span>FANS / CAP</span>
              <strong className="fans-count">
                {String(fans).padStart(3, "0")}
                <small>/{currentVehicle.capacity}</small>
              </strong>
            </div>
            <div className="hud-block combo-block">
              <span>BEAT COMBO</span>
              <strong>×{combo}</strong>
            </div>
            <div
              className={`music-state ${toneMode !== "normal" ? `is-variation is-${toneMode}` : ""}`}
            >
              <strong>{songReady ? currentBpm : "--"} BPM</strong>
              <span>
                {status === "lucky"
                  ? "锦囊抉择中 · TEMPO HOLD"
                  : status === "paused"
                  ? "已暂停 · P / ESC 继续"
                  : toneMode !== "normal"
                  ? `${toneMode === "thick" ? "厚" : "细"}音色中 · TEMPO LOCK`
                  : shield
                    ? "护盾减伤 READY"
                    : "对准点子按 HIT"}
              </span>
            </div>
          </div>

          <div className="vehicle-upgrade-strip" aria-label="车辆升级任务">
            <div className="vehicle-level-badge">
              <small>BUS</small>
              <strong>LV.{currentVehicle.level}</strong>
            </div>
            <div className="vehicle-task-copy">
              <strong>
                {currentVehicle.name}
                <span>载客上限 {currentVehicle.capacity}</span>
              </strong>
              <small>{currentVehicle.task}</small>
            </div>
            <div className="vehicle-task-meter" aria-label={`升级任务进度 ${vehicleTaskProgress}%`}>
              <span style={{ width: `${vehicleTaskProgress}%` }} />
              <b>{currentVehicle.requirement ? `${vehicleTaskProgress}%` : "MAX"}</b>
            </div>
          </div>

          <div className="progress-track" aria-label={`巡演进度 ${Math.round(progress)}%`}>
            <span style={{ width: `${progress}%` }} />
          </div>

          <div className="game-screen">
            <canvas
              ref={canvasRef}
              width={GAME_WIDTH}
              height={GAME_HEIGHT}
              aria-label="五车道节奏躲避游戏画面"
            />

            {(magnetRemaining > 0 || invincibleRemaining > 0) && (
              <div className="powerup-hud" aria-live="polite">
                {magnetRemaining > 0 && (
                  <div className="powerup-chip is-magnet">
                    <i className="powerup-icon" aria-hidden="true" />
                    <span>
                      <small>MAGNET</small>
                      <strong>{(magnetRemaining / 1000).toFixed(1)}s</strong>
                    </span>
                    <b>
                      <i
                        style={{
                          width: `${Math.min(
                            100,
                            (magnetRemaining / POWERUP_DURATION_MS) * 100,
                          )}%`,
                        }}
                      />
                    </b>
                  </div>
                )}
                {invincibleRemaining > 0 && (
                  <div className="powerup-chip is-invincible">
                    <i className="powerup-icon" aria-hidden="true">
                      ★
                    </i>
                    <span>
                      <small>INVINCIBLE</small>
                      <strong>{(invincibleRemaining / 1000).toFixed(1)}s</strong>
                    </span>
                    <b>
                      <i
                        style={{
                          width: `${Math.min(
                            100,
                            (invincibleRemaining / POWERUP_DURATION_MS) * 100,
                          )}%`,
                        }}
                      />
                    </b>
                  </div>
                )}
              </div>
            )}

            {toast && (
              <div key={toast.key} className={`game-toast tone-${toast.tone}`}>
                {toast.text}
              </div>
            )}

            {noteJudgement && (
              <div
                key={noteJudgement.key}
                className={`note-judgement quality-${noteJudgement.quality.toLowerCase()}`}
                aria-live="polite"
              >
                <strong>{noteJudgement.quality}</strong>
                <span>{noteJudgement.detail}</span>
              </div>
            )}

            {status === "ready" && readyPage === "rules" && (
              <div className="game-overlay rules-overlay">
                <p className="overlay-kicker">TONIGHT&apos;S STORY / TOUR CALL</p>
                <div className="rules-logo" aria-hidden="true">
                  ★
                </div>
                <h1 className="story-title">
                  <span>应援大巴</span>
                  <em>冲冲冲！</em>
                </h1>
                <p className="rules-lead">
                  今晚，明星已经登上大巴，但车上的粉丝还是 0。
                  穿过霓虹城市，把一路加入的粉丝
                  <strong>安全送到演唱会</strong>！
                </p>
                <div className="rules-grid story-route" aria-label="巡演故事">
                  <div>
                    <b>01</b>
                    <span>
                      <strong>空车出发</strong>
                      粉丝数从 0 开始，等待你沿途召集今晚的应援队。
                    </span>
                  </div>
                  <div>
                    <b>02</b>
                    <span>
                      <strong>收集应援棒</strong>
                      应援棒到达黄色判定线时按 <em>HIT</em> 吸粉；命中 1
                      根，粉丝 +1。
                    </span>
                  </div>
                  <div>
                    <b>03</b>
                    <span>
                      <strong>点亮更大舞台</strong>
                      把更多粉丝安全送达，解锁更大的演唱会场馆。
                    </span>
                  </div>
                </div>
                <div className="story-mission">
                  <span>TONIGHT&apos;S GOAL</span>
                  <strong>让每一位粉丝准时抵达现场</strong>
                  <small>道路安全第一，遇到行人必须停车礼让。</small>
                </div>
                <button
                  className="primary-button rules-start-button"
                  onClick={() => setReadyPage("songs")}
                >
                  开始巡演 · 进入选歌
                </button>
              </div>
            )}

            {status === "ready" && readyPage === "songs" && (
              <div className="game-overlay intro-overlay">
                <div className="song-select-title">
                  <p className="overlay-kicker">SONG SELECT</p>
                  <h1>选歌</h1>
                  <span>每首歌都有独立卡点、换道路线与道路主题</span>
                </div>
                <div className="track-picker" aria-label="选择歌曲">
                  {TRACKS.filter((track) => track.audioSrc).map(
                    (track, index) => {
                      const isSelected = selectedTrackId === track.id;
                      return (
                        <button
                          type="button"
                          key={track.id}
                          className={isSelected ? "is-selected" : ""}
                          onClick={() =>
                            void loadBuiltInTrack(
                              track.id as Exclude<TrackId, "custom-upload">,
                            )
                          }
                          style={{ color: track.color }}
                          aria-pressed={isSelected}
                        >
                          <span className="song-number">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="track-copy">
                            <b>{track.name}</b>
                            <small>
                              {track.artist} · {track.description}
                            </small>
                          </span>
                          <em>
                            {isSelected && songReady
                              ? `${detectedBpm} BPM`
                              : track.mapLabel}
                          </em>
                          <i>
                            {isSelected && songLoading
                              ? "ANALYZING"
                              : isSelected && songReady
                                ? "✓ 已选择"
                                : track.difficulty}
                          </i>
                        </button>
                      );
                    },
                  )}
                  <label
                    className={`uploaded-track-row ${
                      selectedTrackId === "custom-upload" ? "is-selected" : ""
                    }`}
                    htmlFor="custom-song-upload"
                  >
                    <span className="song-number">04</span>
                    <span className="track-copy">
                      <b>
                        {selectedTrackId === "custom-upload" && songReady
                          ? songTitle
                          : "上传自己的歌曲"}
                      </b>
                      <small>
                        {selectedTrackId === "custom-upload" && songLoading
                          ? "正在拆解节拍与鼓点…"
                          : selectedTrackId === "custom-upload" && songReady
                            ? "节拍分析完成，可以发车"
                            : "支持 MP3 / M4A / WAV / AAC / OGG"}
                      </small>
                    </span>
                    <em>
                      {selectedTrackId === "custom-upload" && songLoading
                        ? "分析中"
                        : selectedTrackId === "custom-upload" && songReady
                          ? `${detectedBpm} BPM · ${Math.floor(songDuration / 60)}:${String(
                              Math.floor(songDuration % 60),
                            ).padStart(2, "0")}`
                          : "自定义巡演"}
                    </em>
                    <i>
                      {selectedTrackId === "custom-upload" && songLoading
                        ? "ANALYZING"
                        : selectedTrackId === "custom-upload" && songReady
                          ? "✓ 已选择"
                          : "UPLOAD"}
                    </i>
                  </label>
                </div>
                <input
                  id="custom-song-upload"
                  className="visually-hidden"
                  type="file"
                  accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac,.mgg"
                  onChange={handleSongUpload}
                />
                <label className="upload-button" htmlFor="custom-song-upload">
                  ＋ 上传本地歌曲
                </label>
                {songFileName && selectedTrackId === "custom-upload" && (
                  <p className="file-status" title={songFileName}>
                    {songReady ? "✓" : "…"} {songFileName}
                  </p>
                )}
                {songError && <p className="song-error">{songError}</p>}
                <label className="song-player-name-field">
                  <span>
                    <small>PLAYER NAME</small>
                    <strong>排行榜昵称</strong>
                  </span>
                  <input
                    value={playerName}
                    maxLength={10}
                    onChange={(event) => {
                      const nextName = event.target.value;
                      playerNameRef.current = nextName;
                      setPlayerName(nextName);
                      window.localStorage.setItem(
                        "fan-bus-player-name",
                        nextName,
                      );
                    }}
                    placeholder="请输入昵称后发车"
                    aria-label="排行榜昵称"
                  />
                  <em>成绩将以此昵称进入全局排行榜</em>
                </label>
                <div className="result-actions song-start-actions">
                  <button
                    className="primary-button"
                    onClick={() => void startGame()}
                    disabled={
                      !songReady || songLoading || !playerName.trim()
                    }
                  >
                    <span>
                      ▶
                    </span>
                    {" "}
                    {!playerName.trim()
                      ? "请填写排行榜昵称"
                      : songLoading
                      ? "正在生成卡点地图…"
                      : songReady
                        ? `用《${songTitle}》发车`
                        : "请选择歌曲"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => setReadyPage("rules")}
                  >
                    查看玩法
                  </button>
                </div>
                <p className="control-hint">
                  ← → / A D 换道 · SPACE 击打 · P / ESC 暂停
                </p>
              </div>
            )}

            {status === "paused" && (
              <div className="game-overlay pause-overlay">
                <p className="overlay-kicker">TOUR PAUSED</p>
                <div className="pause-icon" aria-hidden="true">
                  Ⅱ
                </div>
                <h2>巡演暂停</h2>
                <p>
                  歌曲、节拍和道路已经冻结。<br />
                  继续后从当前拍点重新出发。
                </p>
                <div className="result-actions pause-actions">
                  <button
                    className="primary-button"
                    onClick={() => void resumeGame()}
                  >
                    ▶ 继续游戏
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => void startGame()}
                  >
                    ↻ 重新开局
                  </button>
                  <button
                    className="secondary-button"
                    onClick={returnToSongSelect}
                  >
                    返回选歌
                  </button>
                </div>
                <small className="pause-hint">P / ESC 继续</small>
              </div>
            )}

            {status === "lucky" && luckyDialog && (
              <div
                className={`game-overlay lucky-overlay ${
                  luckyDialog.phase === "result"
                    ? `is-${luckyDialog.outcome}`
                    : ""
                }`}
                role="dialog"
                aria-modal="true"
                aria-live="assertive"
                aria-label={
                  luckyDialog.phase === "choice"
                    ? "是否开启锦囊"
                    : "锦囊开启结果"
                }
              >
                <p className="overlay-kicker">
                  {luckyDialog.phase === "choice"
                    ? "MYSTERY BAG"
                    : "MYSTERY REVEALED"}
                </p>
                <div className="lucky-dialog-icon" aria-hidden="true">
                  {luckyDialog.phase === "choice"
                    ? "?"
                    : luckyDialog.outcome === "double"
                      ? "×2"
                      : "÷2"}
                </div>

                {luckyDialog.phase === "choice" ? (
                  <>
                    <h2>是否开启锦囊？</h2>
                    <p className="lucky-dialog-copy">
                      开启后可能让粉丝翻倍，也可能直接减少一半。<br />
                      不开启则不会改变当前粉丝数。
                    </p>
                    <div className="lucky-risk-row" aria-label="锦囊可能结果">
                      <div className="lucky-risk-card is-good">
                        <small>GOOD LUCK</small>
                        <strong>
                          <i>↑</i>
                          <span>粉丝</span>
                          <b>×2</b>
                        </strong>
                        <em>最高到车辆载客上限</em>
                      </div>
                      <div className="lucky-risk-random" aria-hidden="true">
                        <b>?</b>
                        <small>随机</small>
                      </div>
                      <div className="lucky-risk-card is-risk">
                        <small>RISK</small>
                        <strong>
                          <i>↓</i>
                          <span>粉丝</span>
                          <b>÷2</b>
                        </strong>
                        <em>粉丝减半并中断连击</em>
                      </div>
                    </div>
                    <div className="result-actions lucky-actions">
                      <button className="primary-button" onClick={openLuckyBag}>
                        开启锦囊
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => void continueLuckyGame()}
                      >
                        暂不开启
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h2>
                      {luckyDialog.outcome === "double"
                        ? "好运翻倍！"
                        : "锦囊反转…"}
                    </h2>
                    <p className="lucky-result-label">
                      {luckyDialog.outcome === "double"
                        ? luckyDialog.capped
                          ? `粉丝翻倍成功，车辆达到 ${luckyDialog.capacity} 人上限`
                          : "粉丝数量成功翻倍"
                        : "粉丝数量减少一半，连击已中断"}
                    </p>
                    <div className="lucky-result-numbers">
                      <span>{luckyDialog.before}</span>
                      <i>→</i>
                      <strong>{luckyDialog.after}</strong>
                    </div>
                    <button
                      className="primary-button"
                      onClick={() => void continueLuckyGame()}
                    >
                      确认并继续
                    </button>
                  </>
                )}
              </div>
            )}

            {status === "finished" && (
              <div className="game-overlay result-overlay">
                <p className="overlay-kicker">TOUR COMPLETE</p>
                <div className="stage-icon" style={{ color: resultTier.color }}>
                  {resultTier.icon}
                </div>
                <p className="result-label">今晚成功解锁</p>
                <h2 style={{ color: resultTier.color }}>{resultTier.name}</h2>
                <p className="result-place">
                  {songTitle} · {resultTier.place}
                </p>
                <div className="result-stats">
                  <div>
                    <small>到场粉丝</small>
                    <strong>{fans}</strong>
                  </div>
                  <div>
                    <small>最高连击</small>
                    <strong>×{maxCombo}</strong>
                  </div>
                  <div>
                    <small>演出金币</small>
                    <strong className="gold-text">+{earnedCoins}</strong>
                  </div>
                </div>
                <p className="concert-score">
                  演唱会积分 <strong>{fans}</strong> 粉丝 ×{" "}
                  <strong>{maxCombo}</strong> 连击 ={" "}
                  <b>{fans * maxCombo}</b>
                </p>
                <p className="coin-formula">
                  场馆奖励 {resultTier.coins} + 合拍奖励 {maxCombo * 3}
                </p>
                {leaderboardPanel}
                <div className="result-actions">
                  <button className="primary-button" onClick={() => void startGame()}>
                    再跑一场
                  </button>
                  <button className="secondary-button" onClick={returnToSongSelect}>
                    返回选歌
                  </button>
                </div>
              </div>
            )}

            {status === "failed" && (
              <div className="game-overlay failed-overlay">
                <p className="overlay-kicker">EMERGENCY STOP</p>
                <div className="failure-sign">!</div>
                <p className="result-label">检测到行人</p>
                <h2>演出取消</h2>
                <p className="failure-copy">
                  大巴紧急刹车保护过马路的老奶奶。<br />
                  本次不获得演出金币，请重新挑战。
                </p>
                <div className="failure-ticket">
                  <span>FINAL FANS</span>
                  <strong>{fans}</strong>
                  <small>COINS +0</small>
                </div>
                {leaderboardPanel}
                <div className="result-actions">
                  <button className="primary-button" onClick={() => void startGame()}>
                    重新发车
                  </button>
                  <button className="secondary-button" onClick={returnToSongSelect}>
                    返回选歌
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mobile-controls">
            <div
              className={`joystick-control ${status !== "playing" ? "is-disabled" : ""}`}
              aria-label="左右换道摇杆"
            >
              <div
                className="joystick-base"
                role="slider"
                tabIndex={status === "playing" ? 0 : -1}
                aria-label="拖动摇杆左右换道"
                aria-valuemin={-1}
                aria-valuemax={1}
                aria-valuenow={joystickDirectionRef.current}
                aria-disabled={status !== "playing"}
                onPointerDown={(event) => {
                  if (statusRef.current !== "playing") return;
                  event.preventDefault();
                  joystickPointerRef.current = event.pointerId;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  updateJoystick(event.clientX, event.currentTarget);
                }}
                onPointerMove={(event) => {
                  if (joystickPointerRef.current !== event.pointerId) return;
                  event.preventDefault();
                  updateJoystick(event.clientX, event.currentTarget);
                }}
                onPointerUp={(event) => {
                  if (joystickPointerRef.current === event.pointerId) {
                    event.preventDefault();
                    stopJoystick();
                  }
                }}
                onPointerCancel={stopJoystick}
                onLostPointerCapture={stopJoystick}
              >
                <span className="joystick-track" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <b
                  className="joystick-knob"
                  style={{ transform: `translateX(${joystickOffset}px)` }}
                  aria-hidden="true"
                >
                  ↔
                </b>
              </div>
              <small>DRAG TO STEER</small>
            </div>
            <button
              className="hit-button"
              onPointerDown={(event) => {
                event.preventDefault();
                hitNote();
              }}
              aria-label="击打当前节拍"
              disabled={status !== "playing"}
            >
              <span>HIT</span>
              <small>SPACE</small>
            </button>
          </div>
        </div>
      </section>

      <footer>
        <span>换道也要踩点</span>
        <i />
        <span>祝你一路涨粉</span>
      </footer>
    </main>
  );
}
