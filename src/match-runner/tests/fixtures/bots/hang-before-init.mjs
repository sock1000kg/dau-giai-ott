#!/usr/bin/env node

// Does not read from stdin at all. Kept running to test startup timeout backpressure.
setInterval(() => {}, 10000);
