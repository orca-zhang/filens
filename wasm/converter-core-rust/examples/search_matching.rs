// Run the shared retrieval tests without linking every document/image parser:
// cargo test --features text-extraction,postscript --example search_matching
#[cfg(all(test, feature = "text-extraction"))]
#[path = "../src/text/search.rs"]
mod search;
#[cfg(all(test, feature = "text-extraction"))]
#[path = "../src/text/stopwords.rs"]
mod stopwords;

fn main() {}
