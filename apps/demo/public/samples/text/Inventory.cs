using System;
using System.Collections.Generic;
using System.Linq;

record Material(string Name, int InStock, int Reserved) {
    public int Available => Math.Max(0, InStock - Reserved);
}

class Inventory {
    static void Main() {
        var materials = new List<Material> {
            new("厚纸", 120, 36),
            new("软胶板", 24, 12),
            new("水性油墨", 8, 3)
        };
        var lowStock = materials
            .Where(material => material.Available < 15)
            .OrderBy(material => material.Available);

        Console.WriteLine("需要补充的材料 / Restock list");
        foreach (var material in lowStock) {
            Console.WriteLine($"{material.Name}: {material.Available} available");
        }
    }
}
