import gulp from "gulp";
import del from "del";
import sourcemaps from "gulp-sourcemaps";
import babel from "gulp-babel";
import path from "path";

const clean = () => del(path.join(__dirname, "build"));

const transpile = () =>
  gulp
    .src(["src/*.js"])
    .pipe(sourcemaps.init())
    .pipe(babel({ plugins: ["add-module-exports"] })) // No .default({})
    .pipe(sourcemaps.mapSources(sourcePath => `../src/${sourcePath}`))
    .pipe(sourcemaps.write("."))
    .pipe(gulp.dest("build/"));

const copy = () =>
  gulp.src("./{package.json,LICENSE,README.md}").pipe(gulp.dest("build/"));

// eslint-disable-next-line import/prefer-default-export
export const nodeTranspile = gulp.series(clean, transpile, copy);
