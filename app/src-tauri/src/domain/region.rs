#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct LogicalRect {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PixelRect {
    pub left: u32,
    pub top: u32,
    pub width: u32,
    pub height: u32,
}

impl LogicalRect {
    pub fn scale(&self, factor: f64) -> PixelRect {
        PixelRect {
            left: (self.left * factor).max(0.0).round() as u32,
            top: (self.top * factor).max(0.0).round() as u32,
            width: (self.width * factor).max(0.0).round() as u32,
            height: (self.height * factor).max(0.0).round() as u32,
        }
    }

    /// Clip the rect so it lies fully inside `screen` (logical units). Mirrors
    /// `PixelRect::clamp_to`; used to keep selections inside the display edge
    /// before they reach the capture adapter.
    pub fn clamp_to(&self, screen: LogicalRect) -> LogicalRect {
        let s_right = screen.left + screen.width;
        let s_bottom = screen.top + screen.height;

        let left = self.left.max(screen.left);
        let top = self.top.max(screen.top);

        let left_shift = (left - self.left).max(0.0);
        let top_shift = (top - self.top).max(0.0);

        let width = (self.width - left_shift).min(s_right - left).max(0.0);
        let height = (self.height - top_shift).min(s_bottom - top).max(0.0);

        LogicalRect { left, top, width, height }
    }
}

impl PixelRect {
    pub fn clamp_to(&self, screen: PixelRect) -> PixelRect {
        let s_right = screen.left.saturating_add(screen.width);
        let s_bottom = screen.top.saturating_add(screen.height);

        let left = self.left.max(screen.left);
        let top = self.top.max(screen.top);

        let left_shift = left.saturating_sub(self.left);
        let top_shift = top.saturating_sub(self.top);

        let width = self.width.saturating_sub(left_shift).min(s_right.saturating_sub(left));
        let height = self.height.saturating_sub(top_shift).min(s_bottom.saturating_sub(top));

        PixelRect { left, top, width, height }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaling_physical_retina_2x() {
        let r = LogicalRect { left: 0.0, top: 0.0, width: 800.0, height: 600.0 };
        let p = r.scale(2.0);
        assert_eq!(p, PixelRect { left: 0, top: 0, width: 1600, height: 1200 });
    }

    #[test]
    fn clamp_within_screen() {
        let screen = PixelRect { left: 0, top: 0, width: 1920, height: 1080 };
        let r = LogicalRect { left: -50.0, top: 0.0, width: 2000.0, height: 500.0 }.scale(1.0);
        let c = r.clamp_to(screen);
        assert_eq!(c, PixelRect { left: 0, top: 0, width: 1920, height: 500 });
    }

    #[test]
    fn logical_clamp_keeps_rect_inside_logical_screen() {
        let screen = LogicalRect { left: 0.0, top: 0.0, width: 1512.0, height: 982.0 };
        let c = LogicalRect {
            left: -20.0,
            top: 900.0,
            width: 1600.0,
            height: 200.0,
        }
        .clamp_to(screen);
        assert_eq!(
            c,
            LogicalRect {
                left: 0.0,
                top: 900.0,
                width: 1512.0,
                height: 82.0,
            }
        );
    }
}
