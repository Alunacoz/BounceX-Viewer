#!/usr/bin/env bash

# edit_frames.sh — Add or remove frames from the start of a video using ffmpeg
# Usage: ./edit_frames.sh <input_video>

set -euo pipefail

# ─── Validate input ───────────────────────────────────────────────────────────
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <input_video>"
  exit 1
fi

INPUT="$1"

if [[ ! -f "$INPUT" ]]; then
  echo "Error: File '$INPUT' not found."
  exit 1
fi

if ! command -v ffmpeg &>/dev/null; then
  echo "Error: ffmpeg is not installed or not in your PATH."
  exit 1
fi

# ─── Probe video for framerate ────────────────────────────────────────────────
echo ""
echo "Probing video: $INPUT"

FPS=$(ffprobe -v error \
  -select_streams v:0 \
  -show_entries stream=r_frame_rate \
  -of default=noprint_wrappers=1:nokey=1 \
  "$INPUT")

# r_frame_rate is often a fraction like "30000/1001" — evaluate it
FPS_DECIMAL=$(awk "BEGIN { printf \"%.6f\", $FPS }")
echo "Detected framerate: $FPS ($FPS_DECIMAL fps)"

# ─── Prompt: add or remove ────────────────────────────────────────────────────
echo ""
echo "What would you like to do to the START of the video?"
echo "  1) Add black frames"
echo "  2) Remove frames"
printf "Enter choice [1/2]: "
read -r CHOICE

if [[ "$CHOICE" != "1" && "$CHOICE" != "2" ]]; then
  echo "Invalid choice. Exiting."
  exit 1
fi

# ─── Prompt: number of frames ─────────────────────────────────────────────────
printf "How many frames? "
read -r NUM_FRAMES

if ! [[ "$NUM_FRAMES" =~ ^[1-9][0-9]*$ ]]; then
  echo "Error: Please enter a positive integer."
  exit 1
fi

# ─── Build output filename ────────────────────────────────────────────────────
BASENAME="${INPUT%.*}"
EXT="${INPUT##*.}"

if [[ "$CHOICE" == "1" ]]; then
  OUTPUT="${BASENAME}_add${NUM_FRAMES}frames.${EXT}"
else
  OUTPUT="${BASENAME}_remove${NUM_FRAMES}frames.${EXT}"
fi

# ─── Calculate duration in seconds for the frame count ───────────────────────
DURATION_SEC=$(awk "BEGIN { printf \"%.10f\", $NUM_FRAMES / ($FPS) }")

echo ""

# ─── ADD black frames ─────────────────────────────────────────────────────────
if [[ "$CHOICE" == "1" ]]; then
  echo "Adding $NUM_FRAMES black frame(s) (~${DURATION_SEC}s) to the start..."

  # Get video resolution and pixel format for the black clip
  WIDTH=$(ffprobe -v error -select_streams v:0 \
    -show_entries stream=width -of csv=p=0 "$INPUT")
  HEIGHT=$(ffprobe -v error -select_streams v:0 \
    -show_entries stream=height -of csv=p=0 "$INPUT")
  PIX_FMT=$(ffprobe -v error -select_streams v:0 \
    -show_entries stream=pix_fmt -of csv=p=0 "$INPUT")
  PIX_FMT="${PIX_FMT:-yuv420p}"

  # Check if the source has audio
  HAS_AUDIO=$(ffprobe -v error -select_streams a \
    -show_entries stream=codec_type -of csv=p=0 "$INPUT" | head -1)

  if [[ -n "$HAS_AUDIO" ]]; then
    # Get audio sample rate and channel count
    SAMPLE_RATE=$(ffprobe -v error -select_streams a:0 \
      -show_entries stream=sample_rate -of csv=p=0 "$INPUT")
    CHANNELS=$(ffprobe -v error -select_streams a:0 \
      -show_entries stream=channels -of csv=p=0 "$INPUT")

    ffmpeg -y \
      -f lavfi -i "color=c=black:size=${WIDTH}x${HEIGHT}:duration=${DURATION_SEC}:rate=${FPS}" \
      -f lavfi -i "aevalsrc=0:channel_layout=${CHANNELS}c:sample_rate=${SAMPLE_RATE}:duration=${DURATION_SEC}" \
      -i "$INPUT" \
      -filter_complex \
        "[0:v]format=${PIX_FMT}[bv];
         [bv][1:a][2:v][2:a]concat=n=2:v=1:a=1[outv][outa]" \
      -map "[outv]" -map "[outa]" \
      "$OUTPUT"
  else
    ffmpeg -y \
      -f lavfi -i "color=c=black:size=${WIDTH}x${HEIGHT}:duration=${DURATION_SEC}:rate=${FPS}" \
      -i "$INPUT" \
      -filter_complex \
        "[0:v]format=${PIX_FMT}[bv];
         [bv][1:v]concat=n=2:v=1:a=0[outv]" \
      -map "[outv]" \
      "$OUTPUT"
  fi

# ─── REMOVE frames ────────────────────────────────────────────────────────────
else
  echo "Removing $NUM_FRAMES frame(s) (~${DURATION_SEC}s) from the start..."

  # Trim by seeking to the calculated duration offset
  ffmpeg -y \
    -ss "$DURATION_SEC" \
    -i "$INPUT" \
    -c copy \
    "$OUTPUT"
fi

echo ""
echo "✓ Done! Output saved to: $OUTPUT"
