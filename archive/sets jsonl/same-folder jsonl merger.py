import glob
import os

# Find all jsonl files, excluding the output file just in case
input_files = sorted([f for f in glob.glob("*.jsonl") if f != "lorapois_master.jsonl"])
output_file = "lorapois_master.jsonl"

if not input_files:
    print("No .jsonl files found in this folder.")
else:
    print(f"Found {len(input_files)} files to merge:")
    for f in input_files:
        print(f" - {f}")

    total_lines = 0
    with open(output_file, "w", encoding="utf-8") as outfile:
        for fname in input_files:
            with open(fname, "r", encoding="utf-8") as infile:
                # Read lines, skip empty ones, and write
                lines = [line for line in infile if line.strip()]
                outfile.writelines(lines)
                total_lines += len(lines)
                print(f"   -> Added {len(lines)} lines from {fname}")

    print(f"\nSuccess! Merged {len(input_files)} files into {output_file}")
    print(f"Total training lines: {total_lines}")