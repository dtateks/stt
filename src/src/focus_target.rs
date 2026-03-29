use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FrontmostApplicationTarget {
    pub(crate) process_id: i32,
    pub(crate) bundle_identifier: Option<String>,
}

pub(crate) struct TextInsertionTargetState {
    captured_target: Mutex<Option<FrontmostApplicationTarget>>,
}

impl Default for TextInsertionTargetState {
    fn default() -> Self {
        Self {
            captured_target: Mutex::new(None),
        }
    }
}

impl TextInsertionTargetState {
    pub(crate) fn capture_with<CaptureFrontmost>(&self, capture_frontmost: CaptureFrontmost)
    where
        CaptureFrontmost: FnOnce() -> Option<FrontmostApplicationTarget>,
    {
        if let Ok(mut captured_target) = self.captured_target.lock() {
            *captured_target = capture_frontmost();
        }
    }

    pub(crate) fn reactivate_with<ReactivateTarget>(
        &self,
        mut reactivate_target: ReactivateTarget,
    ) -> bool
    where
        ReactivateTarget: FnMut(&FrontmostApplicationTarget) -> bool,
    {
        let target = self
            .captured_target
            .lock()
            .ok()
            .and_then(|captured_target| captured_target.clone());

        match target {
            Some(target) => reactivate_target(&target),
            None => false,
        }
    }

    #[cfg(test)]
    fn captured_target_for_tests(&self) -> Option<FrontmostApplicationTarget> {
        self.captured_target
            .lock()
            .ok()
            .and_then(|captured_target| captured_target.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::{FrontmostApplicationTarget, TextInsertionTargetState};

    fn make_target(process_id: i32, bundle_identifier: &str) -> FrontmostApplicationTarget {
        FrontmostApplicationTarget {
            process_id,
            bundle_identifier: Some(bundle_identifier.to_string()),
        }
    }

    #[test]
    fn capture_with_replaces_previous_target() {
        let state = TextInsertionTargetState::default();

        state.capture_with(|| Some(make_target(101, "com.apple.TextEdit")));
        state.capture_with(|| Some(make_target(202, "com.apple.Terminal")));

        assert_eq!(
            state.captured_target_for_tests(),
            Some(make_target(202, "com.apple.Terminal"))
        );
    }

    #[test]
    fn reactivate_with_returns_false_without_target() {
        let state = TextInsertionTargetState::default();
        let mut calls = 0;

        let result = state.reactivate_with(|_target| {
            calls += 1;
            true
        });

        assert!(!result);
        assert_eq!(calls, 0);
    }

    #[test]
    fn reactivate_with_passes_captured_target_to_callback() {
        let state = TextInsertionTargetState::default();
        state.capture_with(|| Some(make_target(303, "com.apple.Notes")));

        let mut observed_pid = None;
        let mut observed_bundle = None;

        let result = state.reactivate_with(|target| {
            observed_pid = Some(target.process_id);
            observed_bundle = target.bundle_identifier.clone();
            true
        });

        assert!(result);
        assert_eq!(observed_pid, Some(303));
        assert_eq!(observed_bundle.as_deref(), Some("com.apple.Notes"));
    }
}
