load("@npm//:@babel/cli/package_json.bzl", "bin")

def babel(name, srcs, **kwargs):
    # rules_js runs in the execroot under the output tree in bazel-out/[arch]/bin
    execroot = "../../.."

    outs = []

    # In this example we compile each file individually on .ts src files.
    # The src files must be .ts files known at the loading phase in order
    # to setup the babel compilation for each .ts file.
    #
    # You might instead use a single babel_cli call to compile
    # a directory of sources into an output directory,
    # but you'll need to:
    # - make sure the input directory only contains files listed in srcs
    # - make sure the js_outs are actually created in the expected path
    for idx, src in enumerate(srcs):
        # JSON does not need to be compiled
        if src.endswith(".json"):
            outs.append(src)
            continue

        # dts are only for type-checking and not to be compiled
        if src.endswith(".d.ts"):
            continue

        if not (src.endswith(".ts") or src.endswith(".tsx")):
            fail("babel example transpiler only supports source .ts[x] files, got: %s" % src)

        # Predict the output paths where babel will write
        js_out = src.replace(".ts", ".js")
        map_out = src.replace(".ts", ".js") + ".map"

        # see https://babeljs.io/docs/en/babel-cli
        args = [
            "--source-maps",
            "--config-file",
            "{}/$(location {})".format(execroot, "//:babel_config"),
            "--presets=@babel/preset-typescript",
            "--out-file",
            "{}/$(location {})".format(execroot, js_out),
            "{}/$(location {})".format(execroot, src),
        ]

        bin.babel(
            name = "{}_{}".format(name, idx),
            srcs = [
                src,
                "//:babel_config",
                "//:package_json",
            ],
            outs = [js_out, map_out],
            args = args,
            **kwargs
        )

        outs.append(js_out)
        outs.append(map_out)

    # The target whose default outputs are the js files which ts_project() will reference
    native.filegroup(
        name = name,
        srcs = outs,
    )
