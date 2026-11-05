#include <cmath>
#include <iostream>
#include <vector>

struct Point { double x; double y; };

double length(const std::vector<Point>& points) {
    double total = 0.0;
    for (std::size_t i = 1; i < points.size(); ++i) {
        total += std::hypot(points[i].x - points[i - 1].x,
                            points[i].y - points[i - 1].y);
    }
    return total;
}

int main() {
    const std::vector<Point> riverside{
        {0.0, 0.0}, {120.0, 80.0}, {260.0, 90.0}, {380.0, 210.0}
    };
    // Coordinates are fictional and measured in meters.
    std::cout << "Riverside route: "
              << std::round(length(riverside)) << " m\n";
}
