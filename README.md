# maps_llm

## What is it?

Move the map to the area you want to explore, then ask in Japanese, for example `電源があるカフェ` (cafés with power outlets). Chat searches the **current map viewport** using Google Places; naming a distant neighborhood does not move the search there. A manual search form is also available.

Both search modes fetch up to 20 places and their reviews in one Google Places request. Pins appear before individual review analysis finishes. Their colors show how well each place matches **your criterion**, not its Google star rating. Select a scored place to see the original supporting reviews (up to three), each with its own attribution when available. If the reviews do not establish whether a place meets your criterion, it receives no score.

## Development and handoff

Start with the [session handoff](docs/handoff.md) for the current status and next steps. The [documentation index](docs/README.md) links the improvement plan, API limits, and historical cost audit.

Earlier interface:

![Earlier Maps LLM interface](docs/img/maps_llm_1.png)
