// This file runs in the MAIN world (page context) via chrome.scripting.executeScript.
// It can access window.netflix directly.

(function () {
  function extractNetflixProfiles() {
    // Strategy 1: Falcor cache (browse/watch/search pages)
    try {
      var cache = window.netflix && window.netflix.appContext &&
        window.netflix.appContext.state && window.netflix.appContext.state.pathEvaluator &&
        window.netflix.appContext.state.pathEvaluator._root &&
        window.netflix.appContext.state.pathEvaluator._root.cache;
      if (cache && cache.profiles) {
        var guids = Object.keys(cache.profiles).filter(function (k) { return !k.startsWith('$'); });
        if (guids.length > 0) {
          return guids.map(function (guid) {
            var profile = cache.profiles[guid];
            var summary = (profile && profile.summary && profile.summary.value) || (profile && profile.summary);
            var avatarUrl = null;
            try {
              var img = cache.avatars && cache.avatars.nf && cache.avatars.nf[guid] &&
                cache.avatars.nf[guid].images && cache.avatars.nf[guid].images.byWidth &&
                cache.avatars.nf[guid].images.byWidth['320'];
              avatarUrl = (img && typeof img.value === 'string') ? img.value : null;
            } catch (e) {}
            return {
              guid: guid,
              name: summary && summary.profileName,
              isKids: (summary && (summary.isKids || summary.isDefaultKidsProfile)) || false,
              avatarUrl: avatarUrl,
              restrictionsUrl: 'https://www.netflix.com/settings/restrictions/' + guid
            };
          }).filter(function (p) { return p.name; });
        }
      }
    } catch (e) {}

    // Strategy 2: Apollo GraphQL cache (account pages)
    try {
      var gqlData = window.netflix && window.netflix.reactContext &&
        window.netflix.reactContext.models && window.netflix.reactContext.models.graphql &&
        window.netflix.reactContext.models.graphql.data;
      if (gqlData) {
        var entries = Object.entries(gqlData).filter(function (pair) {
          return pair[0].startsWith('Profile:{');
        });
        if (entries.length > 0) {
          return entries.map(function (pair) {
            var key = pair[0], value = pair[1];
            var match = key.match(/"guid":"([^"]+)"/);
            var guid = match ? match[1] : null;
            var iconRef = value.icon && value.icon.__ref;
            var avatarUrl = iconRef ? (gqlData[iconRef] && gqlData[iconRef].url) : null;
            return {
              guid: guid,
              name: value.name,
              isKids: value.isKids || false,
              avatarUrl: avatarUrl,
              restrictionsUrl: 'https://www.netflix.com/settings/restrictions/' + guid
            };
          });
        }
      }
    } catch (e) {}

    // Strategy 3: profilesModel (restrictions pages)
    try {
      var pm = window.netflix && window.netflix.reactContext &&
        window.netflix.reactContext.models && window.netflix.reactContext.models.profilesModel &&
        window.netflix.reactContext.models.profilesModel.data &&
        window.netflix.reactContext.models.profilesModel.data.profiles;
      if (pm && pm.length) {
        return pm.map(function (p) {
          return {
            guid: p.guid,
            name: p.firstName,
            isKids: p.defaultKidsProfile || false,
            avatarUrl: (p.avatarImages && p.avatarImages['320']) || null,
            restrictionsUrl: 'https://www.netflix.com/settings/restrictions/' + p.guid
          };
        });
      }
    } catch (e) {}

    // Strategy 4: DOM profile gate
    try {
      var icons = document.querySelectorAll('[data-profile-guid]');
      if (icons.length > 0) {
        return Array.from(icons).map(function (el) {
          var guid = el.getAttribute('data-profile-guid');
          var nameEl = el.closest('.profile') && el.closest('.profile').querySelector('.profile-name');
          var name = nameEl ? nameEl.textContent.trim() : null;
          var bg = el.style.backgroundImage;
          var bgMatch = bg && bg.match(/url\(["']?([^"')]+)["']?\)/);
          var avatarUrl = bgMatch ? bgMatch[1] : null;
          return {
            guid: guid,
            name: name,
            isKids: false,
            avatarUrl: avatarUrl,
            restrictionsUrl: 'https://www.netflix.com/settings/restrictions/' + guid
          };
        });
      }
    } catch (e) {}

    return null;
  }

  return extractNetflixProfiles();
})();
