use serde::Serialize;

const OS_MACOS: &str = "macos";
#[cfg(target_os = "windows")]
const OS_WINDOWS: &str = "windows";
#[cfg(target_os = "linux")]
const OS_LINUX: &str = "linux";
const OS_UNKNOWN: &str = "unknown";

const SHORTCUT_DISPLAY_MACOS: &str = "macos";
#[cfg(target_os = "windows")]
const SHORTCUT_DISPLAY_WINDOWS: &str = "windows";
const SHORTCUT_DISPLAY_GENERIC: &str = "generic";

const PERMISSION_FLOW_PRIVACY_SETTINGS: &str = "system-settings-privacy";
#[cfg(target_os = "windows")]
const PERMISSION_FLOW_WINDOWS_PRIVACY: &str = "windows-privacy-settings";
const PERMISSION_FLOW_GENERIC: &str = "runtime-permissions";

const BACKGROUND_RECOVERY_DOCKLESS_REOPEN: &str = "dockless-reopen";
#[cfg(target_os = "windows")]
const BACKGROUND_RECOVERY_SYSTEM_TRAY: &str = "system-tray";
const BACKGROUND_RECOVERY_APP_WINDOW: &str = "app-window";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformRuntimeInfo {
    pub os: String,
    pub shortcut_display: String,
    pub permission_flow: String,
    pub background_recovery: String,
    pub supports_fullscreen_hud: bool,
    pub requires_privileged_insertion_helper: bool,
}

pub fn get_platform_runtime_info() -> PlatformRuntimeInfo {
    #[cfg(target_os = "macos")]
    {
        return PlatformRuntimeInfo {
            os: OS_MACOS.to_string(),
            shortcut_display: SHORTCUT_DISPLAY_MACOS.to_string(),
            permission_flow: PERMISSION_FLOW_PRIVACY_SETTINGS.to_string(),
            background_recovery: BACKGROUND_RECOVERY_DOCKLESS_REOPEN.to_string(),
            supports_fullscreen_hud: true,
            requires_privileged_insertion_helper: false,
        };
    }

    #[cfg(target_os = "windows")]
    {
        return PlatformRuntimeInfo {
            os: OS_WINDOWS.to_string(),
            shortcut_display: SHORTCUT_DISPLAY_WINDOWS.to_string(),
            permission_flow: PERMISSION_FLOW_WINDOWS_PRIVACY.to_string(),
            background_recovery: BACKGROUND_RECOVERY_SYSTEM_TRAY.to_string(),
            supports_fullscreen_hud: true,
            requires_privileged_insertion_helper: true,
        };
    }

    #[cfg(target_os = "linux")]
    {
        return PlatformRuntimeInfo {
            os: OS_LINUX.to_string(),
            shortcut_display: SHORTCUT_DISPLAY_GENERIC.to_string(),
            permission_flow: PERMISSION_FLOW_GENERIC.to_string(),
            background_recovery: BACKGROUND_RECOVERY_APP_WINDOW.to_string(),
            supports_fullscreen_hud: false,
            requires_privileged_insertion_helper: false,
        };
    }

    #[allow(unreachable_code)]
    PlatformRuntimeInfo {
        os: OS_UNKNOWN.to_string(),
        shortcut_display: SHORTCUT_DISPLAY_GENERIC.to_string(),
        permission_flow: PERMISSION_FLOW_GENERIC.to_string(),
        background_recovery: BACKGROUND_RECOVERY_APP_WINDOW.to_string(),
        supports_fullscreen_hud: false,
        requires_privileged_insertion_helper: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_runtime_info_pins_the_macos_capability_set() {
        let info = get_platform_runtime_info();

        assert_eq!(info.os, "macos");
        assert_eq!(info.shortcut_display, "macos");
        assert_eq!(info.permission_flow, "system-settings-privacy");
        assert_eq!(info.background_recovery, "dockless-reopen");
        assert!(info.supports_fullscreen_hud);
        assert!(!info.requires_privileged_insertion_helper);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_runtime_info_pins_the_windows_capability_set() {
        let info = get_platform_runtime_info();

        assert_eq!(info.os, "windows");
        assert_eq!(info.shortcut_display, "windows");
        assert_eq!(info.permission_flow, "windows-privacy-settings");
        assert_eq!(info.background_recovery, "system-tray");
        assert!(info.supports_fullscreen_hud);
        assert!(info.requires_privileged_insertion_helper);
    }

    #[test]
    fn runtime_info_serializes_with_camel_case_field_names() {
        let info = get_platform_runtime_info();
        let json = serde_json::to_value(&info).expect("info must serialise");
        let object = json
            .as_object()
            .expect("info must serialise as a JSON object");

        // The UI bridge reads camelCase keys; any drift here breaks the
        // platform-aware copy in `ui/src/main.ts`.
        assert!(object.contains_key("os"));
        assert!(object.contains_key("shortcutDisplay"));
        assert!(object.contains_key("permissionFlow"));
        assert!(object.contains_key("backgroundRecovery"));
        assert!(object.contains_key("supportsFullscreenHud"));
        assert!(object.contains_key("requiresPrivilegedInsertionHelper"));
        // And NOT the snake_case form.
        assert!(!object.contains_key("shortcut_display"));
        assert!(!object.contains_key("permission_flow"));
    }
}
