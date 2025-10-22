"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cacheWarmer = exports.apiCacheManager = exports.paperCacheManager = exports.searchCacheManager = exports.cacheManager = void 0;
exports.getSearchCache = getSearchCache;
exports.getPaperCache = getPaperCache;
exports.generateCacheKey = generateCacheKey;
const node_cache_1 = __importDefault(require("node-cache"));
const cache_manager_1 = require("./cache-manager");
Object.defineProperty(exports, "cacheManager", { enumerable: true, get: function () { return cache_manager_1.cacheManager; } });
const search_cache_manager_1 = require("./search-cache-manager");
const paper_cache_manager_1 = require("./paper-cache-manager");
const api_cache_manager_1 = require("./api-cache-manager");
const cache_warmer_1 = require("./cache-warmer");
// Legacy cache instances for backward compatibility
const searchCache = new node_cache_1.default({
    stdTTL: 300, // 5 minutes
    checkperiod: 60 // Check for expired keys every minute
});
const paperCache = new node_cache_1.default({
    stdTTL: 600, // 10 minutes
    checkperiod: 60
});
// Initialize advanced cache managers
const searchCacheManager = new search_cache_manager_1.SearchCacheManager(cache_manager_1.cacheManager);
exports.searchCacheManager = searchCacheManager;
const paperCacheManager = new paper_cache_manager_1.PaperCacheManager(cache_manager_1.cacheManager);
exports.paperCacheManager = paperCacheManager;
const apiCacheManager = new api_cache_manager_1.APICacheManager(cache_manager_1.cacheManager);
exports.apiCacheManager = apiCacheManager;
const cacheWarmer = new cache_warmer_1.CacheWarmer(cache_manager_1.cacheManager, searchCacheManager, paperCacheManager, apiCacheManager);
exports.cacheWarmer = cacheWarmer;
// Legacy functions for backward compatibility
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