"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSearchCache = getSearchCache;
exports.getPaperCache = getPaperCache;
exports.generateCacheKey = generateCacheKey;
const node_cache_1 = __importDefault(require("node-cache"));
// Create cache instances
const searchCache = new node_cache_1.default({
    stdTTL: 300, // 5 minutes
    checkperiod: 60 // Check for expired keys every minute
});
const paperCache = new node_cache_1.default({
    stdTTL: 600, // 10 minutes
    checkperiod: 60
});
function getSearchCache() {
    return searchCache;
}
function getPaperCache() {
    return paperCache;
}
function generateCacheKey(prefix, params) {
    const sortedParams = Object.keys(params)
        .sort()
        .reduce((result, key) => {
        result[key] = params[key];
        return result;
    }, {});
    return `${prefix}:${JSON.stringify(sortedParams)}`;
}
//# sourceMappingURL=cache.js.map