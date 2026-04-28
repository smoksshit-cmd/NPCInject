(function () {
    'use strict';

    var SETTINGS_KEY = 'npc_inject_settings';
    var NPC_STORAGE_KEY = 'npc_inject_npcs';
    var pendingInject = null;
    var pendingMark = null;
    var msgCounter = 0;

    // === DEFAULTS ===
    var DEFAULTS = {
        enabled: true,
        mode: 'random',
        encounterEveryN: 5,
        encounterChance: 30,
        groupChance: 35,
        autoDetectScene: true,
        manualScene: '',
        useCustomEndpoint: false,
        customEndpointUrl: '',
        customApiKey: '',
        customModel: '',
        skipTags: ['death', 'trauma', 'finale'],
    };

    // === SETTINGS ===
    function getSettings() {
        try {
            var s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
            return Object.assign({}, DEFAULTS, s || {});
        } catch (e) { return Object.assign({}, DEFAULTS); }
    }
    function saveSettings(s) {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { }
    }

    // === NPC STORAGE ===
    function loadNPCs() {
        try { return JSON.parse(localStorage.getItem(NPC_STORAGE_KEY) || '[]'); } catch (e) { return []; }
    }
    function saveNPCs(list) {
        try { localStorage.setItem(NPC_STORAGE_KEY, JSON.stringify(list)); } catch (e) { }
    }
    async function loadBuiltinNPCs() {
        try {
            var r = await fetch('/scripts/extensions/third-party/NPCInject/npcs.json');
            if (r.ok) return await r.json();
        } catch (e) { console.warn('[NPCInject] fetch npcs.json:', e); }
        return [];
    }

    // === ST HELPERS ===
    function getSTContext() {
        try { return window.SillyTavern ? window.SillyTavern.getContext() : null; } catch (e) { return null; }
    }
    function getChat() {
        var ctx = getSTContext();
        return (ctx && ctx.chat) || window.chat || [];
    }

    // === SCENE DETECTION ===
    var SCENE_PATTERNS = [
        [/таверн[аеу]|трактир|tavern|inn/i, 'tavern'],
        [/бар[ауе]?\b|паб|pub/i, 'bar'],
        [/рынок|базар|market/i, 'market'],
        [/улиц[аеу]|переулок|площадь|street|alley/i, 'street'],
        [/кафе|ресторан|cafe|restaurant/i, 'cafe'],
        [/лес|роща|чаща|forest|woods/i, 'forest'],
        [/замок|дворец|castle|palace/i, 'castle'],
        [/вечеринк|party|клуб/i, 'party'],
        [/бой|сражени|битв|fight|battle|combat/i, 'fight'],
        [/больниц|госпиталь|hospital/i, 'hospital'],
        [/библиотек|library/i, 'library'],
        [/магазин|лавк|shop/i, 'shop'],
    ];

    function detectScene(chat) {
        var recent = chat.slice(-4).map(function (m) { return m.mes || ''; }).join(' ');
        for (var i = 0; i < SCENE_PATTERNS.length; i++) {
            if (SCENE_PATTERNS[i][0].test(recent)) return SCENE_PATTERNS[i][1];
        }
        return '';
    }

    function shouldSkip(chat, skipTags) {
        var recent = chat.slice(-3).map(function (m) { return m.mes || ''; }).join(' ').toLowerCase();
        for (var i = 0; i < skipTags.length; i++) {
            if (recent.indexOf(skipTags[i]) !== -1) return true;
        }
        return false;
    }

    // === ROLES ===
    var ROLES = [
        'случайный прохожий',
        'старый знакомый главного героя',
        'информатор / свидетель',
        'тот кто просто сидит в углу и ест',
        'внезапный союзник / враг',
        'фоновый хаос-агент',
    ];

    function pickRole() {
        return ROLES[Math.floor(Math.random() * ROLES.length)];
    }

    // === PICK NPC ===
    function pickNPC(npcs, scene, mode) {
        var enabled = npcs.filter(function (n) { return n.enabled !== false; });
        if (!enabled.length) return null;

        if (mode === 'thematic' && scene) {
            var matched = enabled.filter(function (n) {
                return n.setting && n.setting.indexOf(scene) !== -1;
            });
            if (matched.length) enabled = matched;
        }

        return enabled[Math.floor(Math.random() * enabled.length)];
    }

    function pickNPCByName(npcs, name) {
        var lower = name.toLowerCase().trim();
        return npcs.find(function (n) {
            return n.name.toLowerCase() === lower || n.id === lower;
        }) || null;
    }

    // === BUILD INJECT ===
    function buildInject(npc, scene, charName, recentContext) {
        var role = pickRole();
        var isGroup = npc.companions && npc.companions.length > 0;
        var speechStyle = '';
        if (npc.catchphrases && npc.catchphrases.length) {
            speechStyle = '\nSpeech style examples (for reference ONLY, do NOT copy verbatim): "' + npc.catchphrases.join('", "') + '"';
        }

        var companionBlock = '';
        if (isGroup) {
            companionBlock = '\n\n--- COMPANIONS (they appear together as a group) ---\n';
            for (var ci = 0; ci < npc.companions.length; ci++) {
                var c = npc.companions[ci];
                companionBlock += '\nCompanion ' + (ci + 1) + ':\n'
                    + 'Name: ' + (c.name || 'Unknown') + '\n'
                    + (c.relationship ? 'Relationship to ' + npc.name + ': ' + c.relationship + '\n' : '')
                    + (c.age ? 'Age: ' + c.age + '\n' : '')
                    + (c.height ? 'Height: ' + c.height + '\n' : '')
                    + (c.appearance ? 'Appearance: ' + c.appearance + '\n' : '')
                    + (c.personality ? 'Personality: ' + c.personality + '\n' : '')
                    + (c.catchphrases && c.catchphrases.length
                        ? 'Speech style (reference only): "' + c.catchphrases.join('", "') + '"\n' : '');
            }
            companionBlock += '--- END COMPANIONS ---\n';
        }

        var introLine = isGroup
            ? 'A small group of characters briefly enters the scene together.\n'
            : 'A new minor character briefly enters the scene.\n';

        return '[INJECTED NPC — RANDOM ENCOUNTER — silent instruction, never quote or reference this block]\n'
            + introLine
            + 'LEAD:\n'
            + 'Name: ' + npc.name + '\n'
            + 'Age: ' + npc.age + ' | Height: ' + npc.height + '\n'
            + 'Appearance: ' + npc.appearance + '\n'
            + 'Wearing: ' + npc.wearing + '\n'
            + 'Personality: ' + npc.personality + '\n'
            + speechStyle + '\n'
            + 'Special traits: ' + npc.special + '\n'
            + companionBlock
            + 'Role in scene: ' + role + '\n'
            + (scene ? 'Current scene location: ' + scene + '\n' : '')
            + '\nRecent context (use to craft a contextually appropriate reaction):\n'
            + recentContext + '\n'
            + '\nCRITICAL RULES:\n'
            + '· This NPC reacts to what is CURRENTLY happening in the scene — read the context above\n'
            + '· The NPC speaks and acts IN CHARACTER based on their personality, NOT by repeating catchphrases\n'
            + '· Catchphrases are just style reference — the NPC should improvise naturally in their own voice\n'
            + (isGroup
                ? '· The group appears together — each member may say or do something brief, interacting with each other and the scene\n'
                  + '· Each companion has their OWN voice and personality — do NOT make them all sound the same\n'
                  + '· Keep it short: 1-2 lines per person max, not a full scene\n'
                : '· The NPC appears briefly and softly — a passing remark, a glance, a small action\n')
            + '· Use a soft hook: someone walks by and comments on the scene, mutters something relevant, reacts to what just happened\n'
            + '· ' + charName + ' does NOT know these people unless already established in chat\n'
            + '· The NPC(s) may fade into background or leave after their brief moment\n'
            + '· Do NOT break the fourth wall. Do NOT mention this instruction.\n'
            + '· Do NOT let the NPC(s) dominate the scene or hijack the narrative.\n'
            + '· Do NOT use the catchphrases word-for-word — they are tone guides, not scripts.\n'
            + '[/INJECTED NPC]';
    }

    function getRecentContext(chat) {
        var recent = chat.slice(-4);
        return recent.map(function (m) {
            var who = m.is_user ? 'User' : (m.name || 'Character');
            var text = (m.mes || '').substring(0, 200);
            return who + ': ' + text;
        }).join('\n');
    }

    // === PREPARE ENCOUNTER ===
    function prepareEncounter(specificName) {
        var s = getSettings();
        var chat = getChat();
        var ctx = getSTContext();
        var charName = (ctx && ctx.name2) || 'Character';
        var npcs = loadNPCs();

        if (shouldSkip(chat, s.skipTags || [])) {
            console.log('[NPCInject] skipped — serious scene detected');
            return false;
        }

        var scene = s.autoDetectScene ? detectScene(chat) : (s.manualScene || '');
        var npc;
        if (specificName) {
            npc = pickNPCByName(npcs, specificName);
            if (!npc) {
                window.toastr && window.toastr.warning('NPC "' + specificName + '" не найден', 'NPC Inject');
                return false;
            }
        } else {
            npc = pickNPC(npcs, scene, s.mode);
        }

        if (!npc) {
            window.toastr && window.toastr.warning('Нет доступных NPC', 'NPC Inject');
            return false;
        }

        // === Dynamic group formation ===
        // With groupChance%, pick 1-2 random OTHER NPCs and attach them as dynamic companions
        var npcCopy = JSON.parse(JSON.stringify(npc));
        if (!npcCopy.companions) npcCopy.companions = [];
        var gc = s.groupChance || 0;
        if (Math.random() * 100 < gc) {
            var others = npcs.filter(function (n) {
                return n.enabled !== false && n.id !== npcCopy.id;
            });
            if (others.length > 0) {
                // Shuffle and pick 1-2
                var shuffled = others.sort(function () { return Math.random() - 0.5; });
                var count = Math.random() < 0.6 ? 1 : 2;
                count = Math.min(count, shuffled.length);
                var DYNAMIC_RELATIONS = [
                    'случайная знакомая', 'подруга по тусовкам', 'соседка',
                    'коллега', 'давняя приятельница', 'знакомая через знакомых',
                    'встретились по дороге', 'старая подруга', 'новая знакомая'
                ];
                for (var di = 0; di < count; di++) {
                    var buddy = shuffled[di];
                    npcCopy.companions.push({
                        name: buddy.name,
                        relationship: DYNAMIC_RELATIONS[Math.floor(Math.random() * DYNAMIC_RELATIONS.length)],
                        age: buddy.age || '',
                        height: buddy.height || '',
                        appearance: buddy.appearance || '',
                        personality: buddy.personality || '',
                        catchphrases: buddy.catchphrases || [],
                        _dynamic: true
                    });
                }
                console.log('[NPCInject] dynamic group formed:', npcCopy.name, '+', npcCopy.companions.filter(function(c){return c._dynamic;}).map(function(c){return c.name;}).join(', '));
            }
        }

        var recentContext = getRecentContext(chat);
        pendingInject = buildInject(npcCopy, scene, charName, recentContext);
        var names = [npcCopy.name];
        if (npcCopy.companions.length) {
            names = names.concat(npcCopy.companions.map(function(c){return c.name;}));
        }
        pendingMark = { name: names.join(' + ') };
        console.log('[NPCInject] queued:', names.join(' + '), 'scene:', scene || 'any');
        return true;
    }

    // === PROMPT HOOK ===
    function onPromptReady(promptData) {
        var s = getSettings();
        if (!s.enabled || !pendingInject) return;

        var block = '\n\n' + pendingInject;
        pendingInject = null;

        if (promptData && typeof promptData.systemPrompt === 'string') {
            promptData.systemPrompt += block;
        } else if (promptData && Array.isArray(promptData.chat)) {
            promptData.chat.unshift({ role: 'system', content: block });
        }
    }

    // === MESSAGE HOOK ===
    function onMessageReceived() {
        var s = getSettings();
        if (!s.enabled) return;

        if (pendingMark) {
            var m = pendingMark; pendingMark = null;
            setTimeout(function () { markMessage(m.name); }, 500);
        }

        if (s.mode === 'spawn_only') return;

        msgCounter++;
        if (msgCounter >= s.encounterEveryN) {
            if (Math.random() * 100 < s.encounterChance) {
                msgCounter = 0;
                prepareEncounter();
            }
        }
    }

    function markMessage(npcName) {
        try {
            var msgs = document.querySelectorAll('.mes[is_user="false"]:not([is_system="true"])');
            if (!msgs.length) return;
            var last = msgs[msgs.length - 1];
            if (last.querySelector('.npc-inject-mark')) return;
            var nameEl = last.querySelector('.name_text');
            if (!nameEl) return;
            var mark = document.createElement('span');
            mark.className = 'npc-inject-mark';
            mark.title = 'NPC Inject: ' + npcName;
            mark.textContent = ' 👤';
            mark.style.cssText = 'font-size:11px;opacity:0.55;cursor:default;user-select:none;';
            nameEl.appendChild(mark);
        } catch (e) { }
    }

    // === ENDPOINT ===
    async function testEndpoint(url, key) {
        var r = await fetch(url.replace(/\/$/, '') + '/models', {
            headers: { 'Authorization': 'Bearer ' + key },
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
    }

    async function loadModels(url, key) {
        var data = await testEndpoint(url, key);
        return data.data ? data.data.map(function (m) { return m.id; }) : (Array.isArray(data) ? data : []);
    }

    // === SLASH COMMAND ===
    function registerSlashCommand() {
        var ctx = getSTContext();
        if (ctx && typeof ctx.registerSlashCommand === 'function') {
            ctx.registerSlashCommand('spawn', function (args) {
                var name = (args || '').trim();
                if (prepareEncounter(name || null)) {
                    window.toastr && window.toastr.info((name || 'Случайный NPC') + ' появится в следующем ответе 👤', 'NPC Inject');
                }
            }, [], '<имя> — вызвать NPC (или случайного)', true, true);
        }
        if (typeof window.registerSlashCommand === 'function') {
            window.registerSlashCommand('spawn', function (n, val) {
                var name = (val || '').trim();
                if (prepareEncounter(name || null)) {
                    window.toastr && window.toastr.info((name || 'Случайный NPC') + ' появится 👤', 'NPC Inject');
                }
            });
        }
    }

    // === BUILD HTML ===
    function buildHTML(npcs) {
        var npcListHTML = '';
        for (var i = 0; i < npcs.length; i++) {
            var n = npcs[i];
            var checked = n.enabled !== false ? 'checked' : '';
            npcListHTML += '<div class="ni-npc-item" data-id="' + n.id + '">'
                + '<label class="ni-chklbl"><input type="checkbox" class="ni-npc-toggle" data-npc-id="' + n.id + '" ' + checked + '/>'
                + '<b>' + n.name + '</b></label>'
                + '<small class="ni-npc-tags">' + (n.tags || []).join(', ') + '</small>'
                + '<button class="ni-btn ni-btn-sm ni-npc-edit" data-npc-id="' + n.id + '" title="Редактировать">✏️</button>'
                + '<button class="ni-btn ni-btn-sm ni-npc-del" data-npc-id="' + n.id + '" title="Удалить">✕</button>'
                + '</div>';
        }

        return '<div id="ni_settings_panel" class="ni-panel">'
            + '<div class="ni-header" id="ni_header_toggle" style="cursor:pointer">'
            + '<span>👤</span><b>NPC Project Inject</b>'
            + '<small>тихушки · энкаунтеры · /spawn</small>'
            + '<span id="ni_collapse_arrow" class="ni-arrow">▼</span>'
            + '<label class="ni-toggle" onclick="event.stopPropagation()">'
            + '<input type="checkbox" id="ni_enabled"/><span class="ni-sw"></span></label></div>'

            + '<div id="ni_body" style="display:none">'

            // MODE
            + '<div class="ni-section"><div class="ni-stitle">🎲 Режим инжекции</div>'
            + '<div class="ni-row"><div class="ni-radios">'
            + '<label><input type="radio" name="ni_mode" value="random"/> 🎲 Полный рандом</label>'
            + '<label><input type="radio" name="ni_mode" value="thematic"/> 🏷 Тематический</label>'
            + '<label><input type="radio" name="ni_mode" value="spawn_only"/> ✋ Только /spawn</label>'
            + '</div></div>'
            + '<div class="ni-row"><span class="ni-lbl">Каждые N сообщений:</span>'
            + '<input type="number" id="ni_every_n" class="ni-num" min="1" max="99"/></div>'
            + '<div class="ni-row"><span class="ni-lbl">Шанс: <b id="ni_chance_val">30</b>%</span>'
            + '<input type="range" id="ni_chance" class="ni-range" min="1" max="100"/></div>'
            + '<div class="ni-row"><span class="ni-lbl">👫 Шанс группы: <b id="ni_group_val">35</b>%</span>'
            + '<input type="range" id="ni_group_chance" class="ni-range" min="0" max="100"/></div>'
            + '<div class="ni-hint">Шанс что NPC придёт не один, а с 1-2 случайными попутчиками из пула</div>'
            + '<div class="ni-row"><label class="ni-chklbl"><input type="checkbox" id="ni_auto_scene"/> 🗺️ Авто-определение сцены</label></div>'
            + '<div class="ni-row"><span class="ni-lbl">Сцена вручную:</span>'
            + '<input type="text" id="ni_manual_scene" class="ni-txt" placeholder="таверна, бой, улица…"/></div>'
            + '<button id="ni_trigger_now" class="ni-btn ni-btn-accent">⚡ Вызвать NPC к следующему ответу</button>'
            + '</div>'

            // NPC LIST
            + '<div class="ni-section"><div class="ni-stitle" id="ni_npc_header" style="cursor:pointer">'
            + '👥 Персоны (' + npcs.length + ') <span id="ni_npc_arrow" class="ni-arrow">▶</span></div>'
            + '<div id="ni_npc_body" style="display:none">'
            + '<div class="ni-hint">Свёрнутый список всех NPC. Включайте/выключайте, удаляйте.</div>'
            + '<div id="ni_npc_list">' + npcListHTML + '</div>'
            + '<div class="ni-row" style="margin-top:6px">'
            + '<button id="ni_create_npc" class="ni-btn ni-btn-accent" style="width:auto;flex:1">➕ Создать NPC</button>'
            + '</div>'
            + '<div class="ni-row">'
            + '<button id="ni_import_npc" class="ni-btn">📥 Импорт JSON</button>'
            + '<button id="ni_reset_npcs" class="ni-btn">🔄 Сбросить к дефолтным</button>'
            + '</div>'
            + '<input type="file" id="ni_import_file" accept=".json" style="display:none"/>'
            + '</div></div>'

            // ENDPOINT
            + '<div class="ni-section"><div class="ni-stitle">🔌 AI эндпоинт'
            + '<label class="ni-toggle ni-toggle-sm" onclick="event.stopPropagation()">'
            + '<input type="checkbox" id="ni_ep_on"/><span class="ni-sw"></span></label></div>'
            + '<div class="ni-hint">Отдельный эндпоинт для генерации NPC (не тратит токены чата)</div>'
            + '<div id="ni_ep_panel">'
            + '<div class="ni-row"><span class="ni-lbl">URL:</span>'
            + '<input type="text" id="ni_ep_url" class="ni-txt" placeholder="https://api.openai.com/v1"/></div>'
            + '<div class="ni-row"><span class="ni-lbl">API ключ:</span>'
            + '<input type="password" id="ni_ep_key" class="ni-txt" placeholder="sk-…"/></div>'
            + '<div class="ni-row"><span class="ni-lbl">Модель:</span>'
            + '<select id="ni_model_sel" class="ni-sel"><option value="">— загрузить —</option></select>'
            + '<button id="ni_load_models" class="ni-btn">🔄</button></div>'
            + '<div class="ni-row"><button id="ni_test_conn" class="ni-btn ni-btn-outline">🔗 Тест соединения</button></div>'
            + '</div></div>'

            + '</div></div>';
    }

    // === BIND UI ===
    async function bindUI() {
        var s = getSettings();
        var collapsed = true;
        var npcCollapsed = true;

        $('#ni_header_toggle').on('click', function () {
            collapsed = !collapsed;
            $('#ni_body').toggle(!collapsed);
            $('#ni_collapse_arrow').text(collapsed ? '▼' : '▲');
        });

        $('#ni_enabled').prop('checked', s.enabled).on('change', function () {
            s.enabled = this.checked; saveSettings(s);
        });

        $('input[name="ni_mode"][value="' + s.mode + '"]').prop('checked', true);
        $('input[name="ni_mode"]').on('change', function () { s.mode = this.value; saveSettings(s); });

        $('#ni_every_n').val(s.encounterEveryN).on('input', function () { s.encounterEveryN = parseInt(this.value) || 5; saveSettings(s); });
        $('#ni_chance').val(s.encounterChance).on('input', function () { s.encounterChance = parseInt(this.value) || 30; $('#ni_chance_val').text(this.value); saveSettings(s); });
        $('#ni_chance_val').text(s.encounterChance);

        $('#ni_group_chance').val(s.groupChance).on('input', function () { s.groupChance = parseInt(this.value) || 0; $('#ni_group_val').text(this.value); saveSettings(s); });
        $('#ni_group_val').text(s.groupChance);

        $('#ni_auto_scene').prop('checked', s.autoDetectScene).on('change', function () { s.autoDetectScene = this.checked; saveSettings(s); });
        $('#ni_manual_scene').val(s.manualScene).on('input', function () { s.manualScene = this.value; saveSettings(s); });

        $('#ni_trigger_now').on('click', function () {
            if (prepareEncounter()) {
                window.toastr && window.toastr.info('NPC появится в следующем ответе 👤', 'NPC Inject');
            }
        });

        // NPC list collapse
        $('#ni_npc_header').on('click', function () {
            npcCollapsed = !npcCollapsed;
            $('#ni_npc_body').toggle(!npcCollapsed);
            $('#ni_npc_arrow').text(npcCollapsed ? '▶' : '▼');
        });

        // NPC toggles
        $(document).on('change', '.ni-npc-toggle', function () {
            var id = $(this).data('npc-id');
            var npcs = loadNPCs();
            var npc = npcs.find(function (n) { return n.id === id; });
            if (npc) { npc.enabled = this.checked; saveNPCs(npcs); }
        });

        // NPC delete
        $(document).on('click', '.ni-npc-del', function () {
            var id = $(this).data('npc-id');
            var npcs = loadNPCs().filter(function (n) { return n.id !== id; });
            saveNPCs(npcs);
            $(this).closest('.ni-npc-item').remove();
            window.toastr && window.toastr.info('NPC удалён', 'NPC Inject');
        });

        // Import
        $('#ni_import_npc').on('click', function () { $('#ni_import_file').click(); });
        $('#ni_import_file').on('change', function (e) {
            var file = e.target.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function (ev) {
                try {
                    var imported = JSON.parse(ev.target.result);
                    if (!Array.isArray(imported)) imported = [imported];
                    var npcs = loadNPCs();
                    imported.forEach(function (imp) {
                        if (!imp.id) imp.id = 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
                        if (!imp.name) imp.name = 'Unknown';
                        if (imp.enabled === undefined) imp.enabled = true;
                        var exists = npcs.findIndex(function (n) { return n.id === imp.id; });
                        if (exists >= 0) npcs[exists] = imp;
                        else npcs.push(imp);
                    });
                    saveNPCs(npcs);
                    window.toastr && window.toastr.success('Импортировано: ' + imported.length + ' NPC', 'NPC Inject');
                    refreshNPCList();
                } catch (err) {
                    window.toastr && window.toastr.error('Ошибка парсинга JSON: ' + err.message, 'NPC Inject');
                }
            };
            reader.readAsText(file);
            this.value = '';
        });

        // Reset
        $('#ni_reset_npcs').on('click', async function () {
            var builtins = await loadBuiltinNPCs();
            saveNPCs(builtins);
            refreshNPCList();
            window.toastr && window.toastr.info('NPC сброшены к дефолтным (' + builtins.length + ')', 'NPC Inject');
        });

        // Endpoint
        $('#ni_ep_on').prop('checked', s.useCustomEndpoint).on('change', function () {
            s.useCustomEndpoint = this.checked; $('#ni_ep_panel').toggle(this.checked); saveSettings(s);
        });
        $('#ni_ep_panel').toggle(s.useCustomEndpoint);
        $('#ni_ep_url').val(s.customEndpointUrl).on('input', function () { s.customEndpointUrl = this.value; saveSettings(s); });
        $('#ni_ep_key').val(s.customApiKey).on('input', function () { s.customApiKey = this.value; saveSettings(s); });

        if (s.customModel) {
            $('#ni_model_sel').empty().append('<option value="' + s.customModel + '">' + s.customModel + '</option>').val(s.customModel);
        }
        $('#ni_model_sel').on('change', function () { s.customModel = this.value; saveSettings(s); });

        $('#ni_load_models').on('click', async function () {
            var btn = $(this).text('…').prop('disabled', true);
            try {
                var models = await loadModels(s.customEndpointUrl, s.customApiKey);
                var sel = $('#ni_model_sel').empty();
                models.forEach(function (m) { sel.append('<option value="' + m + '">' + m + '</option>'); });
                if (s.customModel) sel.val(s.customModel);
                btn.text('✓ (' + models.length + ')');
            } catch (e) {
                btn.text('✗');
                window.toastr && window.toastr.error(e.message, 'NPC Inject');
            }
            btn.prop('disabled', false);
        });

        $('#ni_test_conn').on('click', async function () {
            var btn = $(this).text('Проверка…').prop('disabled', true);
            try {
                await testEndpoint(s.customEndpointUrl, s.customApiKey);
                btn.text('✓ Подключено!');
                window.toastr && window.toastr.success('Работает!', 'NPC Inject');
            } catch (e) {
                btn.text('✗ Ошибка');
                window.toastr && window.toastr.error(e.message, 'NPC Inject');
            }
            setTimeout(function () { btn.text('🔗 Тест соединения').prop('disabled', false); }, 3000);
        });
    }

    // === NPC EDITOR MODAL ===
    function openNPCEditor(npcData) {
        var isNew = !npcData;
        var npc = npcData || {
            id: 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            name: '', age: '', height: '', appearance: '', wearing: '',
            personality: '', catchphrases: [], special: '',
            tags: ['modern', 'any'], setting: [], enabled: true
        };

        // Remove existing modal
        $('#ni_editor_overlay').remove();

        var fields = [
            { key: 'name', label: 'Имя', type: 'text' },
            { key: 'age', label: 'Возраст', type: 'text' },
            { key: 'height', label: 'Рост', type: 'text' },
            { key: 'appearance', label: 'Внешность', type: 'textarea' },
            { key: 'wearing', label: 'Одежда', type: 'textarea' },
            { key: 'personality', label: 'Характер', type: 'textarea' },
            { key: 'catchphrases', label: 'Фразы (стиль речи, через ;)', type: 'text', isArray: true },
            { key: 'special', label: 'Особенности', type: 'textarea' },
            { key: 'tags', label: 'Теги сеттинга (через ,)', type: 'text', isArray: true },
            { key: 'setting', label: 'Локации появления (через ,)', type: 'text', isArray: true },
        ];

        var html = '<div id="ni_editor_overlay" class="ni-modal-overlay">'
            + '<div class="ni-modal">'
            + '<div class="ni-modal-header"><b>' + (isNew ? '➕ Новый NPC' : '✏️ ' + npc.name) + '</b>'
            + '<button id="ni_editor_close" class="ni-btn ni-btn-sm">✕</button></div>'
            + '<div class="ni-modal-body">';

        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            var val = npc[f.key] || '';
            if (f.isArray && Array.isArray(val)) val = val.join(f.key === 'catchphrases' ? '; ' : ', ');
            if (f.type === 'textarea') {
                html += '<div class="ni-field"><label>' + f.label + '</label>'
                    + '<textarea class="ni-txt ni-editor-field" data-key="' + f.key + '" rows="2">' + val + '</textarea></div>';
            } else {
                html += '<div class="ni-field"><label>' + f.label + '</label>'
                    + '<input type="text" class="ni-txt ni-editor-field" data-key="' + f.key + '" value="' + (val + '').replace(/"/g, '&quot;') + '"/></div>';
            }
        }

        // Companions section
        if (!npc.companions) npc.companions = [];
        html += '<div class="ni-companions-section">'
            + '<div class="ni-stitle" style="margin-top:8px">👥 Спутники (группа)</div>'
            + '<div class="ni-hint">Добавь спутников — они появятся вместе с основным NPC как группа</div>'
            + '<div id="ni_companions_list"></div>'
            + '<button id="ni_add_companion" class="ni-btn" style="margin-top:4px">➕ Добавить спутника</button>'
            + '</div>';

        html += '</div><div class="ni-modal-footer">'
            + '<button id="ni_editor_save" class="ni-btn ni-btn-accent" style="width:auto">💾 Сохранить</button>'
            + '<button id="ni_editor_cancel" class="ni-btn">Отмена</button>'
            + '</div></div></div>';

        $('body').append(html);

        // Render existing companions
        function renderCompanions() {
            var container = document.getElementById('ni_companions_list');
            if (!container) return;
            container.innerHTML = '';
            for (var ci = 0; ci < npc.companions.length; ci++) {
                (function(idx) {
                    var comp = npc.companions[idx];
                    var card = document.createElement('div');
                    card.className = 'ni-companion-card';

                    card.innerHTML =
                        '<div class="ni-companion-header">'
                        + '<b>Спутник ' + (idx + 1) + ': ' + (comp.name || '???') + '</b>'
                        + '<button class="ni-btn ni-btn-sm ni-comp-del-btn">✕</button></div>'
                        + '<div class="ni-field"><label>Имя</label><input type="text" class="ni-txt ni-cf" data-ck="name" value="' + (comp.name || '').replace(/"/g, '&quot;') + '"/></div>'
                        + '<div class="ni-field"><label>Связь с лидером</label><input type="text" class="ni-txt ni-cf" data-ck="relationship" placeholder="подруга, сестра, коллега, враг..." value="' + (comp.relationship || '').replace(/"/g, '&quot;') + '"/></div>'
                        + '<div class="ni-field"><label>Возраст</label><input type="text" class="ni-txt ni-cf" data-ck="age" value="' + (comp.age || '').replace(/"/g, '&quot;') + '"/></div>'
                        + '<div class="ni-field"><label>Рост</label><input type="text" class="ni-txt ni-cf" data-ck="height" value="' + (comp.height || '').replace(/"/g, '&quot;') + '"/></div>'
                        + '<div class="ni-field"><label>Внешность</label><textarea class="ni-txt ni-cf" data-ck="appearance" rows="2">' + (comp.appearance || '') + '</textarea></div>'
                        + '<div class="ni-field"><label>Характер</label><textarea class="ni-txt ni-cf" data-ck="personality" rows="2">' + (comp.personality || '') + '</textarea></div>'
                        + '<div class="ni-field"><label>Фразы (стиль, через ;)</label><input type="text" class="ni-txt ni-cf" data-ck="catchphrases" value="' + (comp.catchphrases || []).join('; ').replace(/"/g, '&quot;') + '"/></div>';

                    container.appendChild(card);

                    // Direct event: delete button
                    card.querySelector('.ni-comp-del-btn').addEventListener('click', function(ev) {
                        ev.stopPropagation();
                        npc.companions.splice(idx, 1);
                        renderCompanions();
                    });

                    // Direct events: field changes update npc.companions live
                    var inputs = card.querySelectorAll('.ni-cf');
                    for (var j = 0; j < inputs.length; j++) {
                        (function(input) {
                            input.addEventListener('input', function() {
                                var ck = input.getAttribute('data-ck');
                                if (ck === 'catchphrases') {
                                    npc.companions[idx][ck] = input.value.split(';').map(function(s){ return s.trim(); }).filter(Boolean);
                                } else {
                                    npc.companions[idx][ck] = input.value;
                                }
                            });
                        })(inputs[j]);
                    }
                })(ci);
            }
        }
        renderCompanions();

        // Add companion button — direct binding
        var addCompBtn = document.getElementById('ni_add_companion');
        if (addCompBtn) {
            addCompBtn.addEventListener('click', function(ev) {
                ev.stopPropagation();
                npc.companions.push({ name: '', age: '', height: '', appearance: '', personality: '', catchphrases: [] });
                renderCompanions();
            });
        }

        // Close overlay on background click only
        var overlayEl = document.getElementById('ni_editor_overlay');
        if (overlayEl) {
            overlayEl.addEventListener('click', function(e) {
                if (e.target === overlayEl) overlayEl.remove();
            });
        }
        $('#ni_editor_close, #ni_editor_cancel').on('click', function () {
            $('#ni_editor_overlay').remove();
        });

        $('#ni_editor_save').on('click', function () {
            var npcs = loadNPCs();
            // Gather main fields
            $('.ni-editor-field').each(function () {
                var key = $(this).data('key');
                var raw = $(this).val() || '';
                var fieldDef = fields.find(function (ff) { return ff.key === key; });
                if (fieldDef && fieldDef.isArray) {
                    var sep = key === 'catchphrases' ? ';' : ',';
                    npc[key] = raw.split(sep).map(function (s) { return s.trim(); }).filter(Boolean);
                } else {
                    npc[key] = raw;
                }
            });

            // Gather companion fields
            $('.ni-comp-field').each(function () {
                var ci = parseInt($(this).data('comp-idx'));
                var ckey = $(this).data('comp-key');
                var cval = $(this).val() || '';
                if (!npc.companions[ci]) return;
                if (ckey === 'catchphrases') {
                    npc.companions[ci][ckey] = cval.split(';').map(function (s) { return s.trim(); }).filter(Boolean);
                } else {
                    npc.companions[ci][ckey] = cval;
                }
            });

            // Remove empty companions
            npc.companions = npc.companions.filter(function (c) { return c.name && c.name.trim(); });

            if (!npc.name) { window.toastr && window.toastr.warning('Имя обязательно!', 'NPC Inject'); return; }
            npc.enabled = true;

            var idx = npcs.findIndex(function (n) { return n.id === npc.id; });
            if (idx >= 0) { npcs[idx] = npc; } else { npcs.push(npc); }
            saveNPCs(npcs);
            refreshNPCList();
            $('#ni_editor_overlay').remove();
            window.toastr && window.toastr.success(isNew ? 'NPC создан: ' + npc.name : 'NPC обновлён: ' + npc.name, 'NPC Inject');
        });
    }

    // NPC edit click handler
    $(document).on('click', '.ni-npc-edit', function () {
        var id = $(this).data('npc-id');
        var npcs = loadNPCs();
        var npc = npcs.find(function (n) { return n.id === id; });
        if (npc) openNPCEditor(JSON.parse(JSON.stringify(npc)));
    });

    // NPC create click handler
    $(document).on('click', '#ni_create_npc', function () {
        openNPCEditor(null);
    });

    function refreshNPCList() {
        var npcs = loadNPCs();
        var html = '';
        for (var i = 0; i < npcs.length; i++) {
            var n = npcs[i];
            var checked = n.enabled !== false ? 'checked' : '';
            html += '<div class="ni-npc-item" data-id="' + n.id + '">'
                + '<label class="ni-chklbl"><input type="checkbox" class="ni-npc-toggle" data-npc-id="' + n.id + '" ' + checked + '/>'
                + '<b>' + n.name + '</b></label>'
                + '<small class="ni-npc-tags">' + (n.tags || []).join(', ') + '</small>'
                + '<button class="ni-btn ni-btn-sm ni-npc-edit" data-npc-id="' + n.id + '" title="Редактировать">✏️</button>'
                + '<button class="ni-btn ni-btn-sm ni-npc-del" data-npc-id="' + n.id + '" title="Удалить">✕</button>'
                + '</div>';
        }
        $('#ni_npc_list').html(html);
        $('#ni_npc_header').html('👥 Персоны (' + npcs.length + ') <span id="ni_npc_arrow" class="ni-arrow">▼</span>');
    }

    // === BOOTSTRAP ===
    jQuery(async function () {
        // Init NPC storage from builtin if empty
        var npcs = loadNPCs();
        if (!npcs.length) {
            npcs = await loadBuiltinNPCs();
            saveNPCs(npcs);
        }

        var container = document.getElementById('extensions_settings');
        if (container) {
            var div = document.createElement('div');
            div.innerHTML = buildHTML(npcs);
            container.appendChild(div.firstElementChild);
            await bindUI();
        }

        registerSlashCommand();

        var ctx = getSTContext();
        var es = (ctx && ctx.eventSource) || window.eventSource;
        var et = (ctx && (ctx.eventTypes || ctx.event_types)) || window.event_types;
        if (es && et) {
            es.on(et.MESSAGE_RECEIVED || 'message_received', onMessageReceived);
            es.on(et.CHAT_COMPLETION_PROMPT_READY || 'chat_completion_prompt_ready', onPromptReady);
            if (et.CHARACTER_MESSAGE_RENDERED) {
                es.on(et.CHARACTER_MESSAGE_RENDERED, function () {
                    if (pendingMark) {
                        var m = pendingMark; pendingMark = null;
                        setTimeout(function () { markMessage(m.name); }, 400);
                    }
                });
            }
        }

        console.log('[NPCInject] ✓ v2.0 loaded, NPCs:', npcs.length);
    });
})();
