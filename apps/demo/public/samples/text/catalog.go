// An illustrative read-only endpoint for a fictional exhibition.
package main

import (
    "encoding/json"
    "log"
    "net/http"
    "time"
)

type Exhibit struct {
    ID string
    Title string
    Medium []string
}

func main() {
    exhibits := []Exhibit{
        {ID: "shore-01", Title: "纸上的天气", Medium: []string{"paper", "ink"}},
        {ID: "shore-02", Title: "河流的声音", Medium: []string{"audio"}},
    }
    mux := http.NewServeMux()
    mux.HandleFunc("GET /exhibits", func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json; charset=utf-8")
        if err := json.NewEncoder(w).Encode(exhibits); err != nil {
            log.Print(err)
        }
    })
    server := &http.Server{
        Addr: "127.0.0.1:8080", Handler: mux,
        ReadHeaderTimeout: 5 * time.Second,
    }
    log.Fatal(server.ListenAndServe())
}
