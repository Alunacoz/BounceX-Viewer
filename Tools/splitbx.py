import json
import argparse
from pathlib import Path
from typing import Dict, List, Tuple

def split_bx_file(input_file: str, video_lengths: List[int], output_prefix: str = "video") -> None:
    """
    Split a .bx file into multiple files based on video lengths.
    
    Args:
        input_file: Path to the input .bx file
        video_lengths: List of frame counts for each video segment
        output_prefix: Prefix for output files (will append _1.bx, _2.bx, etc.)
    """
    # Read the input file
    with open(input_file, 'r') as f:
        data = json.load(f)
    
    # Convert string keys to integers for proper sorting
    markers = {int(k): v for k, v in data.items()}
    
    # Calculate segment boundaries
    boundaries = []
    current = 0
    for length in video_lengths:
        boundaries.append((current, current + length))
        current += length
    
    # Split markers into segments
    segments: List[Dict[str, List[float]]] = [{} for _ in range(len(video_lengths))]
    
    for frame_num, values in markers.items():
        # Find which segment this frame belongs to
        for i, (start, end) in enumerate(boundaries):
            if start <= frame_num < end:
                # Adjust frame number to be relative to segment start
                adjusted_frame = frame_num - start
                segments[i][str(adjusted_frame)] = values
                break
    
    # Write each segment to a file
    for i, segment in enumerate(segments):
        output_file = f"{output_prefix}_{i+1}.bx"
        
        # Sort the keys numerically for consistent output
        sorted_segment = {str(k): segment[str(k)] for k in sorted(map(int, segment.keys()))}
        
        with open(output_file, 'w') as f:
            json.dump(sorted_segment, f, indent=None, separators=(',', ':'))
        
        # Count markers in this segment
        marker_count = len(segment)
        print(f"Created {output_file} with {marker_count} markers "
              f"(frames {boundaries[i][0]}-{boundaries[i][1]-1})")

def main():
    parser = argparse.ArgumentParser(description='Split .bx marker files based on video lengths')
    parser.add_argument('input_file', help='Path to the input .bx file')
    parser.add_argument('lengths', nargs='+', type=int, 
                       help='Lengths of video segments in frames (e.g., 13370 10725 9803)')
    parser.add_argument('--output-prefix', default='video', 
                       help='Prefix for output files (default: "video")')
    
    args = parser.parse_args()
    
    # Validate input file exists
    if not Path(args.input_file).exists():
        print(f"Error: Input file '{args.input_file}' not found")
        return
    
    # Validate lengths
    if any(length <= 0 for length in args.lengths):
        print("Error: All video lengths must be positive")
        return
    
    print(f"Splitting {args.input_file} into {len(args.lengths)} segments")
    print(f"Video lengths: {args.lengths} frames")
    print("-" * 50)
    
    split_bx_file(args.input_file, args.lengths, args.output_prefix)
    print("\nDone!")

if __name__ == "__main__":
    main()
