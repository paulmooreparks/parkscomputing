/* The host owns catalog destinations, filter URLs and saved preferences.
   PUDL owns search/category interaction and popup/pane presentation. */
(function () {
    'use strict';
    var root = document.getElementById('site-launcher');
    if (!root || !window.pudlStart || !window.pudlLauncher) { return; }
    var frame = document.getElementById('catalog-workspace');
    var slot = document.getElementById('catalog-slot');
    var restoring = false, tags = [];
    var boxes = Array.from(root.querySelectorAll('[data-catalog-tag-menu] input'));
    var rows = Array.from(root.querySelectorAll('[data-start-item]')).map(function (row) {
        return { element: row, tags: JSON.parse(row.getAttribute('data-catalog-tags') || '[]') };
    });
    function load(key, fallback) {
        try { var value = JSON.parse(localStorage.getItem('pc-launcher-' + key)); return value === null ? fallback : value; }
        catch (err) { return fallback; }
    }
    function save(key, value) {
        try { localStorage.setItem('pc-launcher-' + key, JSON.stringify(value)); } catch (err) { }
    }
    function address(state, selectedTags) {
        var url = new URL(location.href);
        ['q', 'cat', 'tag'].forEach(function (name) { url.searchParams.delete(name); });
        if (state.query) { url.searchParams.set('q', state.query); }
        if (state.category) { url.searchParams.set('cat', state.category); }
        selectedTags.forEach(function (tag) { url.searchParams.append('tag', tag); });
        return url;
    }
    function updateLinks() {
        var state = pudlStart.state(root);
        root.querySelectorAll('[data-start-category-key]').forEach(function (link) {
            link.href = address({ query: state.query, category: link.getAttribute('data-start-category-key') }, tags);
        });
        root.querySelector('[data-catalog-clear]').href = address({ query: '', category: '' }, []);
        root.querySelectorAll('[data-remove-tag]').forEach(function (link) {
            link.href = address(state, tags.filter(function (tag) { return tag !== link.getAttribute('data-remove-tag'); }));
        });
    }
    function remember(push) {
        if (restoring) { return; }
        var url = address(pudlStart.state(root), tags);
        if (url.href !== location.href) { history[push ? 'pushState' : 'replaceState'](history.state, '', url); }
        updateLinks();
        document.dispatchEvent(new CustomEvent('pc:catalog-change'));
    }
    function filterTags() {
        rows.forEach(function (row) {
            row.element.hidden = tags.length > 0 && !row.tags.some(function (tag) { return tags.indexOf(tag) >= 0; });
        });
        boxes.forEach(function (box) { box.checked = tags.indexOf(box.value) >= 0; });
        var chips = root.querySelector('[data-catalog-chips]');
        chips.replaceChildren();
        tags.forEach(function (tag) {
            var chip = document.createElement('span');
            chip.className = 'filter-chip';
            chip.appendChild(document.createTextNode(tag + ' '));
            var remove = document.createElement('a');
            remove.className = 'filter-chip-x';
            remove.setAttribute('data-remove-tag', tag);
            remove.setAttribute('aria-label', 'Remove the ' + tag + ' tag filter');
            chip.appendChild(remove); chips.appendChild(chip);
        });
        pudlStart.refresh(root);
        updateLinks();
    }
    function restoreFilters() {
        restoring = true;
        var params = new URLSearchParams(location.search);
        tags = boxes.map(function (box) { return box.value; }).filter(function (tag) {
            return params.getAll('tag').some(function (value) { return value.toLowerCase() === tag.toLowerCase(); });
        });
        filterTags();
        pudlStart.setState(root, { query: params.get('q') || '', category: params.get('cat') || '' });
        restoring = false;
        updateLinks();
    }
    pudlStart.enhance(root);
    root.addEventListener('pudl:start-change', function (e) {
        if (['query', 'category', 'clear'].indexOf(e.detail.reason) >= 0) { remember(e.detail.reason !== 'query'); }
    });
    root.addEventListener('change', function (e) {
        if (!e.target.closest('[data-catalog-tag-menu]')) { return; }
        tags = boxes.filter(function (box) { return box.checked; }).map(function (box) { return box.value; });
        filterTags(); remember(true);
    });
    root.addEventListener('click', function (e) {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) { return; }
        var clear = e.target.closest('[data-catalog-clear]'), remove = e.target.closest('[data-remove-tag]');
        if (clear || remove) {
            e.preventDefault();
            tags = clear ? [] : tags.filter(function (tag) { return tag !== remove.getAttribute('data-remove-tag'); });
            filterTags();
            if (clear) { pudlStart.setState(root, { query: '', category: '' }); }
            remember(true);
        }
        var destination = e.target.closest('[data-start-item] a, [data-launcher-activate]');
        if (destination) { pudlLauncher.activated(root, destination); }
    });
    restoreFilters();
    remember(false);

    var legacyWidth = load('pane-width', null);
    var paneSize = load('pane-size', Number.isFinite(legacyWidth) && legacyWidth >= 300 ? { width: legacyWidth } : {});
    var categoriesWidth = load('category-width', null);
    if (Number.isFinite(categoriesWidth) && categoriesWidth >= 90) { root.querySelector('.start-content').style.setProperty('--split-a', categoriesWidth + 'px'); }
    var presentation = new URLSearchParams(location.search).get('launcher') || load('presentation', 'pane');
    if (['popup', 'pane', 'collapsed', 'closed'].indexOf(presentation) < 0) { presentation = 'closed'; }
    var compactParam = new URLSearchParams(location.search).get('launcher-visible');
    var compactVisible = compactParam === '1' ? true : compactParam === '0' ? false : load('compact-visible', undefined);
    pudlLauncher.enhance(root, {
        pane: slot, layout: frame,
        invoker: document.getElementById('taskbar-launcher'), placement: 'above',
        size: load('size', { width: 820, height: 620 }), defaultSize: { width: 820, height: 620 },
        paneSize: paneSize, compactVisible: compactVisible, presentation: presentation
    });
    function rememberPresentation(state) {
        document.body.setAttribute('data-launcher-view', state.presentation);
        save('presentation', state.presentation);
        save('size', { width: state.width, height: state.height });
        save('pane-size', state.paneSize);
        if (state.compact) { save('compact-visible', state.visible); }
        var url = new URL(location.href);
        url.searchParams.set('launcher', state.presentation);
        if (state.compact) { url.searchParams.set('launcher-visible', state.visible ? '1' : '0'); }
        else { url.searchParams.delete('launcher-visible'); }
        if (url.href !== location.href) { history.replaceState(history.state, '', url); }
    }
    root.addEventListener('pudl:launcher-change', function (e) { rememberPresentation(e.detail); });
    rememberPresentation(pudlLauncher.state(root));
    document.addEventListener('pudl:split', function (e) {
        if (root.contains(e.target) && e.detail.size != null) { save('category-width', e.detail.size); }
    });
    root.addEventListener('keydown', function (e) {
        if (e.defaultPrevented || e.key !== 'Escape' || e.altKey || e.ctrlKey || e.metaKey || !pudlLauncher.state(root).pinned) { return; }
        if (e.target.closest('[popover]:popover-open') || root.querySelector('[popover]:popover-open')) { return; }
        e.preventDefault(); pudlLauncher.close(root);
    });
    window.addEventListener('popstate', function () {
        restoreFilters();
        var params = new URLSearchParams(location.search);
        var mode = params.get('launcher'), visible = params.get('launcher-visible');
        if (mode) { pudlLauncher.present(root, mode, { focus: false }); }
        if (pudlLauncher.state(root).compact && (visible === '0' || visible === '1')) {
            if (visible === '1') { pudlLauncher.open(root); } else { pudlLauncher.close(root); }
        }
    });
    window.pcLauncher = {
        open: function () { pudlLauncher.open(root); },
        toggle: function () { pudlLauncher.toggle(root); }
    };
})();
