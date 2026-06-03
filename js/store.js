// store.js — shared mutable progress state, exported as singleton objects.
//
// Modules mutate these objects' PROPERTIES in place; the bindings themselves
// are never reassigned (ES module imports are read-only live bindings, so
// `mastery = {...}` from another module would throw). This lets every importer
// observe the same live state without a bundler or framework. See storage.js
// loadMastery/loadViewCounts for the clear-and-repopulate pattern.
'use strict';

// word name -> number of times its detail card has been opened
export const viewCounts = {};

// word name -> { correct, incorrect, lastWrong } quiz performance
export const mastery = {};
