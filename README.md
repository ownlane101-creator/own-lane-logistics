# own-lane-logistics

## Own Lane driver app (`app/`)

A phone-friendly web app for drivers. It can be added to a phone's home screen.

- **Truck stops, truck parking, rest areas and weigh stations** on the map (zoom in to city level). Data comes from OpenStreetMap.
- **Low bridges** shorter than your truck show as red tags with the clearance. **Roads closed to trucks** show as dashed red lines. Zoom in close to see them.
- **Truck-safe routes with live traffic**: routes use your truck's height, weight, length and hazmat class, avoid low bridges and truck-restricted roads, and show traffic delay plus up to 2 alternate routes around it. A live traffic layer is on the map too.

Routing and traffic use TomTom. Get a free API key at developer.tomtom.com and enter it under **⚙ Truck** in the app. The key is saved only on that device.

Run it locally: `python3 -m http.server -d app 8000`, then open http://localhost:8000.
Tests: `node --test app/lib.test.mjs`.

**Driving mode**: tap "Start driving" after picking a route. The map follows your GPS location, shows the next turn and distance in large text, and reads each turn aloud. It does not re-route automatically yet if you leave the route. Always obey posted signs: map data can be missing or out of date.
