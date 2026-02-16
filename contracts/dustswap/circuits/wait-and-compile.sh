#!/bin/bash
# Wait for prepare phase2 to complete, then continue compilation

while pgrep -f "powersoftau prepare phase2" > /dev/null; do
  sleep 5
  echo "⏳ Waiting for prepare phase2 to complete..."
done

echo "✅ Prepare phase2 completed! Continuing compilation..."
sleep 2

# Run compile-fast.sh from Step 2 onwards
./compile-fast.sh
