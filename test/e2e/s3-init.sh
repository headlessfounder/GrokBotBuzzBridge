#!/bin/sh
# Creates the media bucket in the test S3 store, retrying while it starts up.
i=0
while [ "$i" -lt 30 ]; do
  if echo 's3.bucket.create -name e2e-media' | weed shell -master=s3:9333; then
    exit 0
  fi
  i=$((i + 1))
  sleep 2
done
echo "could not create the e2e-media bucket" >&2
exit 1
