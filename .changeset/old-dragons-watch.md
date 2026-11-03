---
"@indexyz/pi-custom-provider": minor
---

Startup no longer waits for the network when model caches exist: expired provider caches and models.dev metadata are registered immediately and refreshed in the background after the session starts, providers without a cache are fetched concurrently, models.dev lookups are indexed, and the cache file keeps only the models.dev fields enrichment needs.
