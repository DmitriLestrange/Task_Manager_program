function getLanguage() {
    return localStorage.getItem("tm_language") || "en";
}

function t(key) {
    const entry = TRANSLATIONS[key];
    if (!entry) {
        return key;
    }
    const language = getLanguage();
    return entry[language] || entry.en || key;
}

function fillTemplate(template, values = {}) {
    return String(template || "").replace(/\{([a-z0-9_]+)\}/gi, (_, key) => {
        return values[key] ?? "";
    });
}

function stylizeFunTranslation(value, language) {
    const text = String(value || "");
    if (!text) {
        return text;
    }
    if (language === "pirate") {
        return text
            .replace(/\bteam\b/gi, "crew")
            .replace(/\busers\b/gi, "crew")
            .replace(/\buser\b/gi, "matey")
            .replace(/\bmessage\b/gi, "missive")
            .replace(/\bmessages\b/gi, "missives")
            .replace(/\btask\b/gi, "duty")
            .replace(/\btasks\b/gi, "duties");
    }
    if (language === "lolcat") {
        return text
            .replace(/\byou\b/gi, "yu")
            .replace(/\bmessages\b/gi, "messagez")
            .replace(/\bmessage\b/gi, "message")
            .replace(/\btasks\b/gi, "taskiez")
            .replace(/\btask\b/gi, "tasky")
            .replace(/\bupdates\b/gi, "updatez");
    }
    if (language === "craft") {
        return text
            .replace(/\btask\b/gi, "quest")
            .replace(/\btasks\b/gi, "quests")
            .replace(/\buser\b/gi, "player")
            .replace(/\busers\b/gi, "players");
    }
    return text;
}

function completeTranslationCoverage() {
    const supportedLanguages = ["en", "ru", "da", "no", "sv", "de", "pl", "uk", "pirate", "lolcat", "craft"];
    for (const entry of Object.values(TRANSLATIONS)) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const english = String(entry.en || "");
        for (const language of supportedLanguages) {
            if (entry[language]) {
                continue;
            }
            entry[language] = ["pirate", "lolcat", "craft"].includes(language)
                ? stylizeFunTranslation(english, language)
                : english;
        }
    }
}

completeTranslationCoverage();

function normalizeUsernameKey(username) {
    return String(username || "").trim().toLowerCase();
}

function isTaskAssignedToCurrentUser(task) {
    if (!task || !currentUser?.username) {
        return false;
    }

    const currentKey = normalizeUsernameKey(currentUser.username);
    return (task.member_details || task.members || []).some((member) => {
        if (typeof member === "string") {
            return normalizeUsernameKey(member) === currentKey;
        }
        return normalizeUsernameKey(member?.username) === currentKey;
    });
}

function canCurrentUserEditTask(task) {
    if (!task || !currentUser) {
        return false;
    }
    if (currentUser.is_admin) {
        return true;
    }
    if (isTaskAssignedToCurrentUser(task)) {
        return true;
    }
    return Boolean(task.is_global) && String(task.global_edit_mode || "members") === "everyone";
}

function canCurrentUserDeleteTask(task) {
    if (!task || !currentUser) {
        return false;
    }
    if (currentUser.is_admin) {
        return true;
    }
    return isTaskAssignedToCurrentUser(task);
}

function getTaskPermissionBadgeText(task) {
    if (!task?.is_global) {
        return "";
    }
    return String(task.global_edit_mode || "members") === "everyone"
        ? t("global_mode_everyone_badge")
        : t("global_mode_members_badge");
}

function getRoleMeta(userLike) {
    return {
        username: userLike?.username || "",
        profile_image_path: userLike?.profile_image_path || "",
        is_admin: Boolean(userLike?.is_admin),
        is_headadmin: Boolean(userLike?.is_headadmin),
    };
}

function getUserMetaByUsername(username) {
    const key = normalizeUsernameKey(username);
    if (!key) {
        return { username: username || "", profile_image_path: "", is_admin: false, is_headadmin: false };
    }

    if (currentUser && normalizeUsernameKey(currentUser.username) === key) {
        return getRoleMeta(currentUser);
    }

    const assignableMatch = assignableUsers.find((user) => normalizeUsernameKey(user.username) === key);
    if (assignableMatch) {
        return getRoleMeta(assignableMatch);
    }

    const adminMatch = adminUsersCache.find((user) => normalizeUsernameKey(user.username) === key);
    if (adminMatch) {
        return getRoleMeta(adminMatch);
    }

    for (const task of tasksCache) {
        const memberMatch = (task.member_details || []).find((member) => normalizeUsernameKey(member.username) === key);
        if (memberMatch) {
            return getRoleMeta(memberMatch);
        }
    }

    return { username, profile_image_path: "", is_admin: false, is_headadmin: false };
}

function getRoleLabel(userLike) {
    if (userLike?.is_headadmin) {
        return t("head_admin");
    }
    if (userLike?.is_admin) {
        return t("admin");
    }
    return "";
}

function renderRoleBadge(userLike, extraClass = "") {
    const label = getRoleLabel(userLike);
    if (!label) {
        return "";
    }
    const roleClass = userLike.is_headadmin ? "admin-badge headadmin-badge" : "admin-badge";
    return `<span class="user-role-badge ${roleClass} ${extraClass}">${escapeHtml(label)}</span>`;
}

function normalizeUploadedImagePath(path) {
    const value = String(path || "").trim();
    if (!value) {
        return "";
    }
    if (/^(data:|https?:\/\/|blob:)/i.test(value)) {
        return value;
    }
    const normalized = value.replace(/\\/g, "/");
    if (normalized.startsWith("/")) {
        return normalized;
    }
    if (normalized.startsWith("static/")) {
        return `/${normalized}`;
    }
    if (normalized.startsWith("uploads/")) {
        return `/static/${normalized}`;
    }
    return `/${normalized.replace(/^\/+/, "")}`;
}

function getUserAvatarSrc(userLike, fallbackName = "TM", options = {}) {
    const pendingData = options.pendingData || "";
    const storedPath = normalizeUploadedImagePath(userLike?.profile_image_path);
    if (storedPath) {
        return storedPath;
    }
    if (pendingData) {
        return pendingData;
    }
    return getDefaultAvatarDataUri(userLike?.username || fallbackName);
}

function renderUserAvatar(userLike, extraClass = "") {
    const username = userLike?.username || "TM";
    const avatarSrc = getUserAvatarSrc(userLike, username);
    return `<img class="user-inline-avatar ${extraClass}" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(username)}" loading="lazy">`;
}

function renderUserDisplayName(userLike, extraBadgeClass = "", options = {}) {
    const meta = typeof userLike === "string" ? getUserMetaByUsername(userLike) : getRoleMeta(userLike);
    const clickable = options.clickable !== false && Boolean(meta.username);
    const showAvatar = Boolean(options.showAvatar);
    const nameMarkup = clickable
        ? `
            <button
                type="button"
                class="user-link"
                data-user-profile="${escapeHtml(meta.username)}"
                title="${escapeHtml(`${t("open_profile")}: ${meta.username}`)}"
            >${escapeHtml(meta.username)}</button>
        `
        : `<span class="user-name">${escapeHtml(meta.username)}</span>`;
    return `
        <span class="user-name-with-badge">
            ${showAvatar ? renderUserAvatar(meta) : ""}
            ${nameMarkup}
            ${renderRoleBadge(meta, extraBadgeClass)}
        </span>
    `;
}

function renderUserList(users) {
    const normalizedUsers = Array.isArray(users) ? users : [];
    return normalizedUsers.length
        ? `<span class="user-inline-list">${normalizedUsers.map((user) => renderUserDisplayName(user, "mini-badge", { showAvatar: true })).join("")}</span>`
        : escapeHtml(t("only_you"));
}

function setText(selector, key) {
    const element = document.querySelector(selector);
    if (element) {
        element.textContent = t(key);
    }
}

function setPlaceholder(selector, key) {
    const element = document.querySelector(selector);
    if (element) {
        element.placeholder = t(key);
    }
}

function getLanguageMeta(code = getLanguage()) {
    return LANGUAGE_META[code] || LANGUAGE_META.en;
}

function renderLanguagePicker() {
    if (!languagePickerBtn || !languagePickerMenu || !languageSelect) {
        return;
    }

    const currentCode = getLanguage();
    const currentMeta = getLanguageMeta(currentCode);

    languagePickerBtn.innerHTML = `
        <span class="language-option-flag" aria-hidden="true">${currentMeta.icon}</span>
        <span class="language-option-label">${escapeHtml(currentMeta.label)}</span>
    `;
    languagePickerBtn.dataset.language = currentCode;

    languagePickerMenu.innerHTML = Object.entries(LANGUAGE_META).map(([code, meta]) => `
        <button
            type="button"
            class="language-option ${code === currentCode ? "active" : ""}"
            data-language-code="${code}"
            role="option"
            aria-selected="${code === currentCode ? "true" : "false"}"
        >
            <span class="language-option-flag" aria-hidden="true">${meta.icon}</span>
            <span class="language-option-label">${escapeHtml(meta.label)}</span>
        </button>
    `).join("");
}

function closeLanguagePicker() {
    if (!languagePickerBtn || !languagePickerMenu) {
        return;
    }
    languagePickerBtn.setAttribute("aria-expanded", "false");
    languagePickerMenu.classList.add("hidden");
}

function openLanguagePicker() {
    if (!languagePickerBtn || !languagePickerMenu) {
        return;
    }
    languagePickerBtn.setAttribute("aria-expanded", "true");
    languagePickerMenu.classList.remove("hidden");
}

function setLanguage(code) {
    const nextCode = LANGUAGE_META[code] ? code : "en";
    localStorage.setItem("tm_language", nextCode);
    if (languageSelect) {
        languageSelect.value = nextCode;
    }
    applyLanguage();
}

function updateStaticTranslations() {
    document.title = t("app_title");
    document.documentElement.lang = getLanguage();

    setText(".auth-header h1", "app_title");
    setText(".auth-header p", "auth_subtitle");
    setText("#showLoginBtn", "log_in");
    setText("#showRegisterBtn", "create_account");
    setText("label[for='loginUsername']", "username");
    setText("label[for='loginPassword']", "password");
    setText("#loginForm button[type='submit']", "log_in");
    setText("#forgotPasswordBtn", "forgot_password");
    setText("label[for='registerUsername']", "username");
    setText("label[for='registerContact']", "email_or_phone");
    setText("label[for='registerPassword']", "password");
    setText("label[for='registerConfirmPassword']", "confirm_password");
    setText("#registerForm .auth-hint", "password_hint");
    setText("#registerForm button[type='submit']", "create_account");
    setText("label[for='resetContact']", "email_or_phone");
    setText("#forgotPasswordRequestForm button[type='submit']", "generate_reset_token");
    setText("#backToLoginBtn", "back_to_login");
    setText("label[for='resetContactConfirm']", "email_or_phone");
    setText("label[for='resetToken']", "reset_token");
    setText("label[for='resetPassword']", "new_password");
    setText("label[for='resetConfirmPassword']", "confirm_new_password");
    setText("#forgotPasswordResetForm .auth-hint:not(#resetTokenInfo)", "password_hint");
    setText("#forgotPasswordResetForm button[type='submit']", "reset_password");
    setText("#requestAnotherTokenBtn", "request_another_token");
    setText("#languageLabel", "language");
    setText("#settingsPanel .settings-header h3", "settings");
    setText("#closeSettingsBtn", "close");
    const themeLabel = themeSelect?.closest("label")?.querySelector("span");
    if (themeLabel) {
        themeLabel.textContent = t("theme");
    }
    const thresholdLabel = upcomingThreshold?.closest("label")?.querySelector("span");
    if (thresholdLabel) {
        thresholdLabel.textContent = t("upcoming_deadline_window");
    }
    const animationsLabel = toggleAnimations?.closest(".custom-check")?.querySelector("span:last-child");
    const notificationsLabel = toggleNotifications?.closest(".custom-check")?.querySelector("span:last-child");
    const compactLabel = compactMode?.closest(".custom-check")?.querySelector("span:last-child");
    const accessibilityLabel = accessibilityMode?.closest(".custom-check")?.querySelector("span:last-child");
    const soundsLabel = toggleSounds?.closest(".custom-check")?.querySelector("span:last-child");
    if (animationsLabel) animationsLabel.textContent = t("enable_animations");
    if (notificationsLabel) notificationsLabel.textContent = t("deadline_reminders");
    if (compactLabel) compactLabel.textContent = t("compact_layout");
    if (accessibilityLabel) accessibilityLabel.textContent = t("accessibility_mode");
    if (soundsLabel) soundsLabel.textContent = t("task_completion_sound");
    resolveSpeechVoice();
    const dashboardBtn = document.querySelector('[data-page="dashboardPage"]');
    const tasksBtn = document.querySelector('[data-page="tasksPage"]');
    const completedBtn = document.querySelector('[data-page="completedPage"]');
    const privateMessagesBtn = document.querySelector('[data-page="privateMessagesPage"]');
    const overviewBtn = document.querySelector('[data-page="overviewPage"]');
    const updatesBtn = document.querySelector('[data-page="updatesPage"]');
    const profileBtn = document.querySelector('[data-page="profilePage"]');
    const analyticsBtn = document.querySelector('[data-page="analyticsPage"]');
    if (dashboardBtn) dashboardBtn.title = t("dashboard");
    if (tasksBtn) tasksBtn.title = t("tasks");
    if (completedBtn) completedBtn.title = t("completed_tasks_page");
    if (privateMessagesBtn) privateMessagesBtn.title = t("private_messages");
    if (overviewBtn) overviewBtn.title = t("overview");
    if (updatesBtn) updatesBtn.title = t("updates");
    if (profileBtn) profileBtn.title = t("profile");
    if (adminNavBtn) adminNavBtn.title = t("admin");
    if (analyticsBtn) analyticsBtn.title = t("analytics");
    if (settingsBtn) settingsBtn.title = t("settings");
    if (logoutBtn) logoutBtn.title = t("logout");
    setText("#dashboardPage .hero-left p:last-of-type", "dashboard_intro");
    setText("#dashboardPage .hero-stats .hero-stat:nth-child(1) span", "total_tasks");
    setText("#dashboardPage .hero-stats .hero-stat:nth-child(2) span", "due_soon");
    setText("#dashboardPage .hero-stats .hero-stat:nth-child(3) span", "overdue");
    setText("#dashboardPage .dashboard-grid .mini-list-card:nth-child(1) .section-head h3", "currently_ongoing_tasks");
    setText("#dashboardPage .dashboard-grid .mini-list-card:nth-child(2) .section-head h3", "upcoming_deadlines");
    setText("#dashboardPage .dashboard-grid .mini-list-card:nth-child(2) .section-head p", "closest_first");
    setText("#dashboardPage .dashboard-grid .mini-list-card:nth-child(3) .section-head h3", "overdue_tasks");
    setText("#dashboardPage .activity-panel .section-head h3", "activity_feed");
    setText("#dashboardPage .activity-panel .section-head p", "live_updates");
    setText("#featuredTaskHeading", "featured_task");
    setText("#featuredTaskSubheading", "featured_task_desc");
    setText("#clearPinnedTaskBtn", "clear_featured_task");
    setText("#tasksPage .section-head h2", "create_task");
    setText("#createTaskHint", "shortcuts_hint_with_tts");
    setText("#dashboardTtsHint", "tts_shortcut_hint");
    setText("#toggleTaskCreatorBtn", taskForm?.classList.contains("collapsed") ? "open_creator" : "close_creator");
    setText("#toggleAdvancedTaskSettingsBtn", advancedTaskSettings?.classList.contains("hidden") ? "advanced_settings" : "hide_advanced_settings");
    setText("label[for='taskTemplateSelect']", "task_template");
    setText("#openTaskTemplateModalBtn", "manage_templates");
    setText("label[for='taskTitle']", "task_title");
    setText("label[for='taskDeadline']", "deadline");
    setText("label[for='taskDescription']", "description");
    setText("label[for='taskPriority']", "priority");
    setText("label[for='taskMembers']", "assign_users");
    setText("label[for='taskGlobalEditMode']", "global_edit_mode");
    setText("label[for='taskMainImageInput']", "main_image");
    setText("label[for='taskBannerImageInput']", "banner_image");
    setText("label[for='taskAttachmentsInput']", "attachments");
    setText("#taskMaterialsHeading", "task_materials");
    setText("#taskMaterialsHint", "task_materials_desc");
    setText("#addTaskMaterialBtn", "add_material");
    setText("label[for='taskMainImageInput'] + .image-upload-card .upload-btn", "choose_main_image");
    setText("label[for='taskBannerImageInput'] + .image-upload-card .upload-btn", "choose_banner_image");
    setText("label[for='taskAttachmentsInput'] + .attachment-upload-card .upload-btn", "choose_files");
    setText("#clearTaskMainImageBtn", "remove_image");
    setText("#clearTaskBannerImageBtn", "remove_image");
    setText("#openAssignUsersBtn", "choose_users");
    setText("#taskForm button[type='submit']", "add_task");
    setText("#tasksPage .tasks-section .section-head h2", "your_tasks");
    setText("#completedPage .section-head-top h2", "completed_tasks_page");
    setText("#completedPage .section-head-top p", "completed_tasks_desc");
    setText("#completedTtsHint", "tts_shortcut_hint");
    setText("#completedSearchHeading", "completed_search_heading");
    setText("#completedSearchHint", "completed_search_hint");
    setText("label[for='completedTaskUserSearch']", "completed_search_user_label");
    setText("#clearCompletedTaskSearchBtn", "clear_search");
    setText("#privateMessagesPage .section-head-top h2", "private_messages");
    setText("#privateMessagesPage .section-head-top p", "private_messages_desc");
    setText("#privateMessagesTtsHint", "tts_shortcut_hint");
    setText("#startPrivateChatBtn", "start_new_chat");
    setText("#privateChatListHeading", "chats");
    setText("#privateChatListHint", "private_chat_list_hint");
    setText("#privateChatTitleHeading", activePrivateChatId ? "private_messages" : "select_private_chat");
    setText("#privateChatTitleSubheading", activePrivateChatId ? "private_messages_desc" : "select_private_chat_desc");
    setText("#startPrivateChatModalTitle", "start_private_chat");
    setText("#closeStartPrivateChatModalBtn", "close");
    setText("#taskTemplateModalTitle", "template_modal_title");
    setText("#taskTemplateModalHint", "template_modal_hint");
    setText("#closeTaskTemplateModalBtn", "close");
    setText("#taskTemplateListHeading", "your_templates");
    setText("#taskTemplateListHint", "task_templates_hint");
    setText("#newTaskTemplateBtn", "new_template");
    setText("#taskTemplateEditorHeading", editingTaskTemplateId ? "task_template" : "new_template");
    setText("#taskTemplateEditorHint", "template_editor_hint");
    setText("label[for='taskTemplateNameInput']", "template_name");
    setText("label[for='taskTemplateDefaultPriority']", "template_default_priority");
    setText("label[for='taskTemplateDescriptionInput']", "description");
    setText("label[for='taskTemplateDeadlineOffsetInput']", "template_default_deadline_offset");
    setText("#taskTemplateSubtasksHeading", "predefined_subtasks");
    setText("#taskTemplateSubtasksHint", "predefined_subtasks_hint");
    setText("#addTaskTemplateSubtaskBtn", "add_subtask");
    setText("#deleteTaskTemplateBtn", "delete_template");
    setText("#saveTaskTemplateBtn", "save_template");
    setText("label[for='privateChatUserSearch']", "search_users");
    setPlaceholder("#privateChatUserSearch", "type_username");
    setPlaceholder("#privateChatInput", "write_private_message");
    setText("#privateChatForm button[type='submit']", "send");
    setText("#overviewPage .section-head-top h2", "global_overview");
    setText("#overviewPage .section-head-top p", "global_overview_desc");
    setText("#overviewTtsHint", "tts_shortcut_hint");
    setText("#updatesPage .section-head-top h2", "update_log");
    setText("#updatesPage .section-head-top p", "update_log_desc");
    setText("#updatesTtsHint", "tts_shortcut_hint");
    setText("#profilePage .section-head-top h2", "account_settings");
    setText("#profilePage .section-head-top p", "account_settings_desc");
    setText("#profileTtsHint", "tts_shortcut_hint");
    setText("#profilePage .profile-card:first-child .section-head h3", "your_profile");
    setText("#profilePage .profile-card:first-child .section-head p", "your_profile_desc");
    setText("label[for='profileImageInput']", "profile_picture");
    setText("label[for='profileUsername']", "username");
    setText("label[for='profileContact']", "email_or_phone");
    setText("#profileForm button[type='submit']", "save_profile");
    setText("#profilePage .profile-card:last-child .section-head h3", "security");
    setText("#profilePage .profile-card:last-child .section-head p", "security_desc");
    setText("label[for='profileNewPassword']", "new_password");
    setText("label[for='profileConfirmPassword']", "confirm_new_password");
    setText("#securityForm .auth-hint", "passwords_hint_plural");
    setText("#securityForm button[type='submit']", "save_security_changes");
    const deleteCard = securityForm?.querySelector(".profile-verify-box");
    if (deleteCard) {
        const deleteTitle = deleteCard.querySelector("strong");
        const deleteDesc = deleteCard.querySelector(".auth-hint:not(#deleteAccountLockNote)");
        if (deleteTitle) {
            deleteTitle.textContent = t("delete_account");
        }
        if (deleteDesc) {
            deleteDesc.textContent = t("delete_account_desc");
        }
    }
    setText("#deleteAccountBtn", "delete_account_button");
    setText("#deleteAccountModalTitle", "delete_account_button");
    setText("#deleteAccountModalText", "delete_account_modal_desc");
    setText("label[for='deleteAccountPassword']", "delete_account_password_label");
    setText("#closeDeleteAccountModalBtn", "close");
    setText("#cancelDeleteAccountBtn", "cancel");
    setText("#confirmDeleteAccountBtn", "delete_account_button");
    setText("#taskCompletionModalTitle", "confirm_task_completion_title");
    setText("#taskCompletionModalText", "confirm_task_completion_desc");
    setText("#closeTaskCompletionModalBtn", "close");
    setText("#cancelTaskCompletionBtn", "cancel");
    setText("#confirmTaskCompletionBtn", "confirm_action");
    setText("#pinnedChatEyebrow", "pinned_chat");
    setText("#closePinnedChatBtn", "close");
    setText("#togglePinnedChatBtn", pinnedChatWindow?.classList.contains("minimized") ? "expand" : "minimize");
    setText("#pinnedChatForm button[type='submit']", "send");
    setPlaceholder("#pinnedChatInput", "write_message");
    setText("#adminPage .section-head-top h2", "admin_panel");
    setText("#adminPage .section-head-top p", "admin_panel_desc");
    setText("#adminTtsHint", "tts_shortcut_hint");
    setText("#adminPage .profile-card:first-child .section-head h3", "admin_access");
    setText("#adminPage .profile-card:first-child .section-head p", "admin_access_desc");
    setText("#adminPage .profile-card:last-child .section-head h3", "user_management");
    setText("#adminPage .profile-card:last-child .section-head p", "user_management_desc");
    setText("#analyticsPage .section-head-top h2", "analytics");
    setText("#analyticsPage .section-head-top p", "analytics_desc");
    setText("#analyticsTtsHint", "tts_shortcut_hint");
    setText("#analyticsPage .analytics-grid .analytics-stat-card:nth-child(1) .analytics-label", "analytics_total_users");
    setText("#analyticsPage .analytics-grid .analytics-stat-card:nth-child(2) .analytics-label", "analytics_total_tasks");
    setText("#analyticsPage .analytics-grid .analytics-stat-card:nth-child(3) .analytics-label", "analytics_completed_tasks");
    setText("#analyticsPage .analytics-grid .analytics-stat-card:nth-child(4) .analytics-label", "analytics_overdue_tasks");
    setText("#analyticsPage .analytics-chart-card .section-head h3", "analytics_completed_over_time");
    setText("#analyticsMaterialsHeading", "materials_used_over_time");
    setText("#analyticsMaterialsSummary", "materials_chart_loading");
    const analyticsFilterLabel = analyticsPeriodSelect?.closest("label")?.querySelector("span");
    if (analyticsFilterLabel) {
        analyticsFilterLabel.textContent = t("analytics_time_period");
    }
    const analyticsChartTypeLabel = analyticsChartTypeSelect?.closest("label")?.querySelector("span");
    if (analyticsChartTypeLabel) {
        analyticsChartTypeLabel.textContent = t("chart_type");
    }
    setText("#userDetailPage .section-head-top h2", "user_profile");
    setText("#userDetailPage .section-head-top p", "user_profile_desc");
    setText("#userDetailTtsHint", "tts_shortcut_hint");
    setText("#userDetailBackBtn", "back");
    setText("#userDetailMessageBtn", "message_user");
    setText("#userDetailPage .user-detail-facts .user-detail-fact:nth-child(1) span", "joined");
    setText("#userDetailPage .user-detail-facts .user-detail-fact:nth-child(2) span", "contact");
    setText("#userDetailPage .user-detail-stats-grid .analytics-stat-card:nth-child(1) .analytics-label", "assigned_tasks");
    setText("#userDetailPage .user-detail-stats-grid .analytics-stat-card:nth-child(2) .analytics-label", "created_tasks");
    setText("#userDetailPage .user-detail-stats-grid .analytics-stat-card:nth-child(3) .analytics-label", "analytics_completed_tasks");
    setText("#userDetailPage .user-detail-stats-grid .analytics-stat-card:nth-child(4) .analytics-label", "analytics_overdue_tasks");
    setText("#userDetailPage .analytics-chart-card .section-head h3", "analytics_completed_over_time");
    const userDetailFilterLabel = userDetailPeriodSelect?.closest("label")?.querySelector("span");
    if (userDetailFilterLabel) {
        userDetailFilterLabel.textContent = t("analytics_time_period");
    }
    setText("#assignUsersModal .section-head h3", "assign_users");
    setText("#closeAssignUsersBtn", "close");
    setText("#editTaskModalTitle", "edit_task");
    setText("label[for='editTaskTitle']", "task_title");
    setText("label[for='editTaskDeadline']", "deadline");
    setText("label[for='editTaskDescription']", "description");
    setText("label[for='editTaskPriority']", "priority");
    setText("label[for='editTaskGlobalEditMode']", "global_edit_mode");
    setText("label[for='editTaskMainImageInput']", "main_image");
    setText("label[for='editTaskBannerImageInput']", "banner_image");
    setText("label[for='editTaskAttachmentsInput']", "attachments");
    setText("#editTaskMaterialsHeading", "task_materials");
    setText("#editTaskMaterialsHint", "edit_task_materials_desc");
    setText("#addEditTaskMaterialBtn", "add_material");
    setText("label[for='editTaskMainImageInput'] + .image-upload-card .upload-btn", "choose_main_image");
    setText("label[for='editTaskBannerImageInput'] + .image-upload-card .upload-btn", "choose_banner_image");
    setText("label[for='editTaskAttachmentsInput'] + .attachment-upload-card .upload-btn", "choose_files");
    setText("#clearEditTaskMainImageBtn", "remove_image");
    setText("#clearEditTaskBannerImageBtn", "remove_image");
    setText("#closeEditTaskModalBtn", "close");
    setText("#cancelEditTaskBtn", "cancel");
    setText("#editTaskForm button[type='submit']", "save_task");
    setText("label[for='assignUserSearch']", "search_users");
    setText("label[for='taskFilterPriority']", "priority");
    setText("label[for='taskFilterDeadlineDate']", "deadline");
    setText("label[for='taskFilterAssignedUser']", "assigned_users");
    setText("label[for='taskFilterGlobalMode']", "scope");
    setText("label[for='taskFilterCompletion']", "completion");
    setText("label[for='taskSortBy']", "sort_by");
    const filterCheckLabels = document.querySelectorAll(".task-filter-actions .custom-check span:last-child");
    if (filterCheckLabels?.[0]) filterCheckLabels[0].textContent = t("invert_filters");
    if (filterCheckLabels?.[1]) filterCheckLabels[1].textContent = t("reverse_sort");
    setText("#clearTaskFiltersBtn", "clear_filters");
    setText("#applyAssignUsersBtn", "apply_selection");
    setPlaceholder("#taskTitle", "task_title_placeholder");
    setPlaceholder("#taskDeadline", "choose_date_time");
    setPlaceholder("#taskDescription", "optional_description");
    setPlaceholder("#taskTemplateNameInput", "template_name_placeholder");
    setPlaceholder("#taskTemplateDescriptionInput", "optional_description");
    setPlaceholder("#taskTemplateDeadlineOffsetInput", "template_default_deadline_offset");
    setPlaceholder("#taskTemplateSubtaskInput", "template_subtask_placeholder");
    setPlaceholder("#editTaskTitle", "task_title_placeholder");
    setPlaceholder("#editTaskDeadline", "choose_date_time");
    setPlaceholder("#editTaskDescription", "optional_description");
    setPlaceholder("#searchInput", "search_tasks_subtasks");
    setPlaceholder("#completedTaskUserSearch", "completed_search_placeholder");
    setPlaceholder("#assignUserSearch", "type_username");
    if (themeSelect?.options[0]) themeSelect.options[0].textContent = t("theme_default");
    if (themeSelect?.options[1]) themeSelect.options[1].textContent = t("theme_dark");
    if (themeSelect?.options[2]) themeSelect.options[2].textContent = t("theme_light");
    const taskPrioritySelect = document.getElementById("taskPriority");
    if (taskTemplateSelect?.options[0]) taskTemplateSelect.options[0].textContent = t("start_from_scratch");
    if (taskPrioritySelect?.options[0]) taskPrioritySelect.options[0].textContent = t("low");
    if (taskPrioritySelect?.options[1]) taskPrioritySelect.options[1].textContent = t("medium");
    if (taskPrioritySelect?.options[2]) taskPrioritySelect.options[2].textContent = t("high");
    if (taskTemplateDefaultPriority?.options[0]) taskTemplateDefaultPriority.options[0].textContent = t("template_keep_task_choice");
    if (taskTemplateDefaultPriority?.options[1]) taskTemplateDefaultPriority.options[1].textContent = t("low");
    if (taskTemplateDefaultPriority?.options[2]) taskTemplateDefaultPriority.options[2].textContent = t("medium");
    if (taskTemplateDefaultPriority?.options[3]) taskTemplateDefaultPriority.options[3].textContent = t("high");
    const subtaskRequirementOptions = document.querySelectorAll(".subtask-form select[name='subtaskRequirementType']");
    subtaskRequirementOptions.forEach((select) => {
        if (select.options[0]) select.options[0].textContent = t("no_requirement");
        if (select.options[1]) select.options[1].textContent = t("file_submission_required");
    });
    if (taskFilterPriority?.options[0]) taskFilterPriority.options[0].textContent = t("all_priorities");
    if (taskFilterPriority?.options[1]) taskFilterPriority.options[1].textContent = t("low");
    if (taskFilterPriority?.options[2]) taskFilterPriority.options[2].textContent = t("medium");
    if (taskFilterPriority?.options[3]) taskFilterPriority.options[3].textContent = t("high");
    if (taskFilterAssignedUser?.options[0]) taskFilterAssignedUser.options[0].textContent = t("all_users");
    if (taskFilterGlobalMode?.options[0]) taskFilterGlobalMode.options[0].textContent = t("all_tasks_filter");
    if (taskFilterGlobalMode?.options[1]) taskFilterGlobalMode.options[1].textContent = t("global_only");
    if (taskFilterGlobalMode?.options[2]) taskFilterGlobalMode.options[2].textContent = t("assigned_only");
    if (taskFilterCompletion?.options[0]) taskFilterCompletion.options[0].textContent = t("all_states");
    if (taskFilterCompletion?.options[1]) taskFilterCompletion.options[1].textContent = t("uncompleted");
    if (taskFilterCompletion?.options[2]) taskFilterCompletion.options[2].textContent = t("completed");
    if (taskSortBy?.options[0]) taskSortBy.options[0].textContent = t("sort_creation_date");
    if (taskSortBy?.options[1]) taskSortBy.options[1].textContent = t("sort_deadline");
    if (taskSortBy?.options[2]) taskSortBy.options[2].textContent = t("sort_priority");
    if (taskSortBy?.options[3]) taskSortBy.options[3].textContent = t("sort_alphabetical");
    const createGlobalLabel = taskIsGlobal?.closest(".custom-check")?.querySelector("span:last-child");
    if (createGlobalLabel) createGlobalLabel.textContent = t("global_task");
    if (taskGlobalEditMode?.options[0]) taskGlobalEditMode.options[0].textContent = t("global_edit_members");
    if (taskGlobalEditMode?.options[1]) taskGlobalEditMode.options[1].textContent = t("global_edit_everyone");
    if (analyticsPeriodSelect?.options[0]) analyticsPeriodSelect.options[0].textContent = t("analytics_24h");
    if (analyticsPeriodSelect?.options[1]) analyticsPeriodSelect.options[1].textContent = t("analytics_1w");
    if (analyticsPeriodSelect?.options[2]) analyticsPeriodSelect.options[2].textContent = t("analytics_1m");
    if (analyticsPeriodSelect?.options[3]) analyticsPeriodSelect.options[3].textContent = t("analytics_1y");
    if (analyticsChartTypeSelect?.options[0]) analyticsChartTypeSelect.options[0].textContent = t("chart_bar");
    if (analyticsChartTypeSelect?.options[1]) analyticsChartTypeSelect.options[1].textContent = t("chart_line");
    if (analyticsChartTypeSelect?.options[2]) analyticsChartTypeSelect.options[2].textContent = t("chart_pie");
    if (userDetailPeriodSelect?.options[0]) userDetailPeriodSelect.options[0].textContent = t("analytics_24h");
    if (userDetailPeriodSelect?.options[1]) userDetailPeriodSelect.options[1].textContent = t("analytics_1w");
    if (userDetailPeriodSelect?.options[2]) userDetailPeriodSelect.options[2].textContent = t("analytics_1m");
    if (userDetailPeriodSelect?.options[3]) userDetailPeriodSelect.options[3].textContent = t("analytics_1y");
    if (editTaskPriority?.options[0]) editTaskPriority.options[0].textContent = t("low");
    if (editTaskPriority?.options[1]) editTaskPriority.options[1].textContent = t("medium");
    if (editTaskPriority?.options[2]) editTaskPriority.options[2].textContent = t("high");
    const editGlobalLabel = editTaskIsGlobal?.closest(".custom-check")?.querySelector("span:last-child");
    if (editGlobalLabel) editGlobalLabel.textContent = t("global_task");
    if (editTaskGlobalEditMode?.options[0]) editTaskGlobalEditMode.options[0].textContent = t("global_edit_members");
    if (editTaskGlobalEditMode?.options[1]) editTaskGlobalEditMode.options[1].textContent = t("global_edit_everyone");
    if (taskMainImagePreview) taskMainImagePreview.alt = t("task_image_preview");
    if (taskBannerImagePreview) taskBannerImagePreview.alt = t("task_banner_preview");
    if (editTaskMainImagePreview) editTaskMainImagePreview.alt = t("task_image_preview");
    if (editTaskBannerImagePreview) editTaskBannerImagePreview.alt = t("task_banner_preview");
    const taskChatHeading = taskTemplate?.content?.querySelector(".chat-block .subtask-head h4");
    if (taskChatHeading) {
        taskChatHeading.textContent = t("task_chat");
    }
    renderPendingAttachmentList(taskAttachmentsList, pendingTaskAttachments, "create");
    renderPendingAttachmentList(editTaskAttachmentsList, editTaskAttachments, "edit");
    renderTaskMaterialConfigList("create");
    renderTaskMaterialConfigList("edit");
    renderCompletedTaskUserSuggestions();
    renderCompletedTasks();
    decorateReadableBlocks();
}

function applyLanguage() {
    if (languageSelect) {
        languageSelect.value = getLanguage();
    }

    renderLanguagePicker();
    updateStaticTranslations();
    applySettings();
    updateWelcome();
    renderSelectedTaskMembers();
    renderAssignableUserList(assignUserSearch?.value || "");
    populateTaskFilterUsers();
    updateAllSecondaryViews();
    renderUpdateLog();
    renderAdminUsers();
    renderPinnedChatWindow();
    populateTaskTemplateSelect();
    renderTaskTemplatePreview();
    renderTaskTemplateList();
    renderTaskTemplateEditorSubtasks();

    tasksCache.forEach((task) => {
        const card = taskList.querySelector(`[data-task-id="${task.id}"]`);
        if (card) {
            syncTaskCardMeta(card, task);
            renderTaskSubtasksInPlace(card, task);
        }
    });

    if (pendingTaskCompletion?.title && !taskCompletionModal?.classList.contains("hidden")) {
        taskCompletionModalTitle.textContent = t("confirm_task_completion_title");
        taskCompletionModalText.textContent = `${t("confirm_task_completion_desc")} "${pendingTaskCompletion.title}"`;
        confirmTaskCompletionBtn.textContent = t("confirm_action");
    }

    decorateReadableBlocks();
}

