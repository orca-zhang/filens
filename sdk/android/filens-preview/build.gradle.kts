plugins { id("com.android.library") }

android {
    namespace = "app.filens.preview"
    compileSdk = 35
    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    publishing { singleVariant("release") { withSourcesJar() } }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}

tasks.register("checkPreviewAssets") {
    doLast {
        check(file("src/main/assets/filens/mobile.html").isFile && file("src/main/assets/filens/filens.js").isFile) {
            "Missing filens runtime. Run npm run build:sdk:mobile from the repository root."
        }
    }
}
tasks.named("preBuild") { dependsOn("checkPreviewAssets") }
