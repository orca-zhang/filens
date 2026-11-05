#[derive(Clone, Copy, Debug)]
struct Color { red: u8, green: u8, blue: u8 }

impl Color {
    fn luminance(self) -> f64 {
        let linear = |value: u8| {
            let v = f64::from(value) / 255.0;
            if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) }
        };
        0.2126 * linear(self.red)
            + 0.7152 * linear(self.green)
            + 0.0722 * linear(self.blue)
    }

    fn prefers_dark_text(self) -> bool { self.luminance() > 0.179 }
}

fn main() {
    let palette = [
        ("苔藓", Color { red: 93, green: 117, blue: 84 }),
        ("晨雾", Color { red: 224, green: 230, blue: 226 }),
        ("陶土", Color { red: 190, green: 109, blue: 76 }),
    ];
    for (name, color) in palette {
        println!("{}: dark text = {}", name, color.prefers_dark_text());
    }
}
