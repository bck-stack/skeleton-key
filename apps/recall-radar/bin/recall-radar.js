#!/usr/bin/env node
/**
 * Recall Radar over stdio. stdout carries JSON-RPC only; logs go to stderr.
 *
 *   node apps/recall-radar/bin/recall-radar.js
 */
import { main } from "./main.js";

process.exitCode = await main();
