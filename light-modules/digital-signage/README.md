# digital-signage

Magnolia light module for the signage content the Frimley demo plays. Editors work in content apps. The player keeps reading the same JSON shape; a later adapter will read the delivery endpoints below.

Written for **Magnolia 6.4**. This repository has no Magnolia runtime, so the version is the current product line rather than a dependency already in the project. The collapsed override field comes from the Content Editor module, which is DX Core.

- [Light modules](https://docs.magnolia-cms.com/product-docs/Modules/Light-modules/)
- [Content type definition](https://docs.magnolia-cms.com/product-docs/Developing/Content-Types/Content-type-definition/)
- [Content type app](https://docs.magnolia-cms.com/product-docs/Developing/Content-Types/Content-Types-tutorial/Part-I-My-first-content-type/)
- [collapsibleCompositeField](https://docs.magnolia-cms.com/product-docs/Apps/Developing-an-app/Developing-a-custom-content-editor-app/)
- [Delivery API v2](https://docs.magnolia-cms.com/product-docs/6.2/Developing/API/Delivery-API/) — this is the newest Delivery API page in the documentation snapshot. 6.4 does not ship a replacement page there. The endpoint type is still `jcrDeliveryEndpoint_v2`. Check the Definitions app after the first start.

## Install

1. Magnolia DX Core 6.4 with the Content Types, Content Editor, DAM and REST Content Delivery modules.
2. Set `magnolia.resources.dir` to the parent `magnolia` folder, or symlink this module into the resources directory.
3. Restart, then log out and back in. The apps are added to the App Launcher **Custom** group ([default group](https://docs.magnolia-cms.com/product-docs/Administration/App-Launcher/App-launcher-layout/)).
4. Open the Definitions app and filter Problems. A red definition there is the thing to fix before editing content.

`module.yaml` depends on `content-types` and `content-editor`.

## Apps

| App | What editors create | Player JSON |
|---|---|---|
| Sites | Home company, timezone, welcome, share-price ticker, and playback defaults | `site.json` |
| Locations | Other sites a deck can belong to | `locations.json` |
| Places | The building / floor / room tree, with inherited playback | `displays.json` folders |
| Displays | A screen: id, the number typed at `/connect`, its place, and optional overrides | `displays.json` displays |
| Decks | Ordered cards. Pick a card type. Overrides and schedule start collapsed | `decks/*.json` |
| Events | What's on | `events.json` |
| Menus | Serving times, everyday counters, and a day-by-day menu | `menus.json` |
| Boards | Safety count, shifts, tiles, reminders | `boards.json` |
| Videos | MP4 and poster from the Assets app, plus an optional cue file | `videos.json` |
| Messages | Statements a message card can pin or rotate | `messages.json` |

There is no app for card types. Welcome, weather, what's on, month ahead, message, video, share price, menu and board are the player components, so the deck form offers them as a fixed list.

### Decks

Each card asks for an id, a card type, a label, a duration and whether it is enabled. Two sections start collapsed:

- **Overrides** — pin a video, message, menu or board, set the month-ahead window, or cap a video. Leave it closed and the card uses its own content.
- **Schedule** — dates, weekdays and times. Leave it closed and the card is always on.

### Places, displays and the site

Playback is deck, mode (`loop`, `interactive`, `video`), idle timeout and reload interval. It is set on the site (defaults), then a place, then a display. Place and display sections start collapsed and an empty field means inherit. The most specific value wins, which is the rule the demo already uses.

Mark one site as the home site. A deck with no location uses that site for weather, welcome copy and events.

### Menus

A missing weekday is how a canteen closes for that day: do not add the day, and the menu card skips it. Dishes can be tagged Vegetarian, Vegan, Gluten free, Dairy free or Halal.

## Delivery endpoints

Published items are what the public instance serves. `bypassWorkspaceAcls` is the [documented delivery setup](https://docs.magnolia-cms.com/product-docs/6.2/Developing/API/Delivery-API/) so the anonymous REST role can read; lock the public instance down with the receiver's ACLs before this faces a real network.

| Endpoint | Workspace |
|---|---|
| `/.rest/delivery/signage-sites` | `signageSites` |
| `/.rest/delivery/signage-locations` | `signageLocations` |
| `/.rest/delivery/signage-places` | `signagePlaces` |
| `/.rest/delivery/signage-displays` | `signageDisplays` |
| `/.rest/delivery/signage-decks` | `signageDecks` |
| `/.rest/delivery/signage-events` | `signageEvents` |
| `/.rest/delivery/signage-menus` | `signageMenus` |
| `/.rest/delivery/signage-boards` | `signageBoards` |
| `/.rest/delivery/signage-videos` | `signageVideos` |
| `/.rest/delivery/signage-messages` | `signageMessages` |

Video files, posters, cue files and welcome images are resolved to DAM assets. Links to other signage items (a deck's location, a card's video, a display's place) stay as Magnolia identifiers. The stable id the player uses is the **Id** field (`slug`). The adapter joins on that.

Card overrides and the schedule are child nodes (`overrides`, `schedule`) because a content type submodel cannot contain another submodel. Menu days, counters and dishes are child nodes for the same reason. Flatten those when building the JSON the player already understands.

Images and video belong in the Assets app. This module does not define page templates.

