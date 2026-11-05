import java.util.Comparator;
import java.util.List;

public class TrailPlanner {
    record Trail(String name, double kilometers, int ascentMeters) {
        double estimatedHours() {
            return kilometers / 4.0 + ascentMeters / 600.0;
        }
    }

    static List<Trail> withinDaylight(List<Trail> trails, double hours) {
        return trails.stream()
                .filter(trail -> trail.estimatedHours() <= hours)
                .sorted(Comparator.comparingDouble(Trail::estimatedHours))
                .toList();
    }

    public static void main(String[] args) {
        var trails = List.of(
                new Trail("青岚环线", 8.4, 320),
                new Trail("河口湿地", 4.2, 20),
                new Trail("东岭山脊", 12.6, 760)
        );
        // Fictional routes; estimates are for this programming example only.
        for (var trail : withinDaylight(trails, 4.0)) {
            System.out.printf("%s: %.1f hours%n",
                    trail.name(), trail.estimatedHours());
        }
    }
}
