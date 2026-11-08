/* three.js r128 公式追加機能（examples/js）を同梱。MIT License（vendor/three.LICENSE.txt）
 * shaders/CopyShader, shaders/FXAAShader, math/SimplexNoise, shaders/SSAOShader,
 * postprocessing/EffectComposer, postprocessing/ShaderPass, postprocessing/SSAOPass */
/* ---- shaders/CopyShader.js ---- */
( function () {

	/**
 * Full-screen textured quad shader
 */
	var CopyShader = {
		uniforms: {
			'tDiffuse': {
				value: null
			},
			'opacity': {
				value: 1.0
			}
		},
		vertexShader:
  /* glsl */
  `

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
		fragmentShader:
  /* glsl */
  `

		uniform float opacity;

		uniform sampler2D tDiffuse;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );
			gl_FragColor = opacity * texel;

		}`
	};

	THREE.CopyShader = CopyShader;

} )();

/* ---- shaders/FXAAShader.js ---- */
( function () {

	/**
 * NVIDIA FXAA by Timothy Lottes
 * http://timothylottes.blogspot.com/2011/06/fxaa3-source-released.html
 * - WebGL port by @supereggbert
 * http://www.glge.org/demos/fxaa/
 */

	const FXAAShader = {
		uniforms: {
			'tDiffuse': {
				value: null
			},
			'resolution': {
				value: new THREE.Vector2( 1 / 1024, 1 / 512 )
			}
		},
		vertexShader:
  /* glsl */
  `

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
		fragmentShader: // FXAA 3.11 implementation by NVIDIA, ported to WebGL by Agost Biro (biro@archilogic.com)
		//----------------------------------------------------------------------------------
		// File:				es3-kepler\FXAA\assets\shaders/FXAA_DefaultES.frag
		// SDK Version: v3.00
		// Email:			 gameworks@nvidia.com
		// Site:				http://developer.nvidia.com/
		//
		// Copyright (c) 2014-2015, NVIDIA CORPORATION. All rights reserved.
		//
		// Redistribution and use in source and binary forms, with or without
		// modification, are permitted provided that the following conditions
		// are met:
		//	* Redistributions of source code must retain the above copyright
		//		notice, this list of conditions and the following disclaimer.
		//	* Redistributions in binary form must reproduce the above copyright
		//		notice, this list of conditions and the following disclaimer in the
		//		documentation and/or other materials provided with the distribution.
		//	* Neither the name of NVIDIA CORPORATION nor the names of its
		//		contributors may be used to endorse or promote products derived
		//		from this software without specific prior written permission.
		//
		// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS ``AS IS\'\' AND ANY
		// EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
		// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
		// PURPOSE ARE DISCLAIMED.	IN NO EVENT SHALL THE COPYRIGHT OWNER OR
		// CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
		// EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
		// PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
		// PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
		// OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
		// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
		// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
		//
		//----------------------------------------------------------------------------------

  /* glsl */
  `

		precision highp float;

		uniform sampler2D tDiffuse;

		uniform vec2 resolution;

		varying vec2 vUv;

		#define FXAA_PC 1
		#define FXAA_GLSL_100 1
		#define FXAA_QUALITY_PRESET 12

		#define FXAA_GREEN_AS_LUMA 1

		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_PC_CONSOLE
				//
				// The console algorithm for PC is included
				// for developers targeting really low spec machines.
				// Likely better to just run FXAA_PC, and use a really low preset.
				//
				#define FXAA_PC_CONSOLE 0
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_GLSL_120
				#define FXAA_GLSL_120 0
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_GLSL_130
				#define FXAA_GLSL_130 0
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_HLSL_3
				#define FXAA_HLSL_3 0
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_HLSL_4
				#define FXAA_HLSL_4 0
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_HLSL_5
				#define FXAA_HLSL_5 0
		#endif
		/*==========================================================================*/
		#ifndef FXAA_GREEN_AS_LUMA
				//
				// For those using non-linear color,
				// and either not able to get luma in alpha, or not wanting to,
				// this enables FXAA to run using green as a proxy for luma.
				// So with this enabled, no need to pack luma in alpha.
				//
				// This will turn off AA on anything which lacks some amount of green.
				// Pure red and blue or combination of only R and B, will get no AA.
				//
				// Might want to lower the settings for both,
				//		fxaaConsoleEdgeThresholdMin
				//		fxaaQualityEdgeThresholdMin
				// In order to insure AA does not get turned off on colors
				// which contain a minor amount of green.
				//
				// 1 = On.
				// 0 = Off.
				//
				#define FXAA_GREEN_AS_LUMA 0
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_EARLY_EXIT
				//
				// Controls algorithm\'s early exit path.
				// On PS3 turning this ON adds 2 cycles to the shader.
				// On 360 turning this OFF adds 10ths of a millisecond to the shader.
				// Turning this off on console will result in a more blurry image.
				// So this defaults to on.
				//
				// 1 = On.
				// 0 = Off.
				//
				#define FXAA_EARLY_EXIT 1
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_DISCARD
				//
				// Only valid for PC OpenGL currently.
				// Probably will not work when FXAA_GREEN_AS_LUMA = 1.
				//
				// 1 = Use discard on pixels which don\'t need AA.
				//		 For APIs which enable concurrent TEX+ROP from same surface.
				// 0 = Return unchanged color on pixels which don\'t need AA.
				//
				#define FXAA_DISCARD 0
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_FAST_PIXEL_OFFSET
				//
				// Used for GLSL 120 only.
				//
				// 1 = GL API supports fast pixel offsets
				// 0 = do not use fast pixel offsets
				//
				#ifdef GL_EXT_gpu_shader4
						#define FXAA_FAST_PIXEL_OFFSET 1
				#endif
				#ifdef GL_NV_gpu_shader5
						#define FXAA_FAST_PIXEL_OFFSET 1
				#endif
				#ifdef GL_ARB_gpu_shader5
						#define FXAA_FAST_PIXEL_OFFSET 1
				#endif
				#ifndef FXAA_FAST_PIXEL_OFFSET
						#define FXAA_FAST_PIXEL_OFFSET 0
				#endif
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_GATHER4_ALPHA
				//
				// 1 = API supports gather4 on alpha channel.
				// 0 = API does not support gather4 on alpha channel.
				//
				#if (FXAA_HLSL_5 == 1)
						#define FXAA_GATHER4_ALPHA 1
				#endif
				#ifdef GL_ARB_gpu_shader5
						#define FXAA_GATHER4_ALPHA 1
				#endif
				#ifdef GL_NV_gpu_shader5
						#define FXAA_GATHER4_ALPHA 1
				#endif
				#ifndef FXAA_GATHER4_ALPHA
						#define FXAA_GATHER4_ALPHA 0
				#endif
		#endif


		/*============================================================================
														FXAA QUALITY - TUNING KNOBS
		------------------------------------------------------------------------------
		NOTE the other tuning knobs are now in the shader function inputs!
		============================================================================*/
		#ifndef FXAA_QUALITY_PRESET
				//
				// Choose the quality preset.
				// This needs to be compiled into the shader as it effects code.
				// Best option to include multiple presets is to
				// in each shader define the preset, then include this file.
				//
				// OPTIONS
				// -----------------------------------------------------------------------
				// 10 to 15 - default medium dither (10=fastest, 15=highest quality)
				// 20 to 29 - less dither, more expensive (20=fastest, 29=highest quality)
				// 39			 - no dither, very expensive
				//
				// NOTES
				// -----------------------------------------------------------------------
				// 12 = slightly faster then FXAA 3.9 and higher edge quality (default)
				// 13 = about same speed as FXAA 3.9 and better than 12
				// 23 = closest to FXAA 3.9 visually and performance wise
				//	_ = the lowest digit is directly related to performance
				// _	= the highest digit is directly related to style
				//
				#define FXAA_QUALITY_PRESET 12
		#endif


		/*============================================================================

															 FXAA QUALITY - PRESETS

		============================================================================*/

		/*============================================================================
												 FXAA QUALITY - MEDIUM DITHER PRESETS
		============================================================================*/
		#if (FXAA_QUALITY_PRESET == 10)
				#define FXAA_QUALITY_PS 3
				#define FXAA_QUALITY_P0 1.5
				#define FXAA_QUALITY_P1 3.0
				#define FXAA_QUALITY_P2 12.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 11)
				#define FXAA_QUALITY_PS 4
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 3.0
				#define FXAA_QUALITY_P3 12.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 12)
				#define FXAA_QUALITY_PS 5
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 4.0
				#define FXAA_QUALITY_P4 12.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 13)
				#define FXAA_QUALITY_PS 6
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 4.0
				#define FXAA_QUALITY_P5 12.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 14)
				#define FXAA_QUALITY_PS 7
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 4.0
				#define FXAA_QUALITY_P6 12.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 15)
				#define FXAA_QUALITY_PS 8
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 2.0
				#define FXAA_QUALITY_P6 4.0
				#define FXAA_QUALITY_P7 12.0
		#endif

		/*============================================================================
												 FXAA QUALITY - LOW DITHER PRESETS
		============================================================================*/
		#if (FXAA_QUALITY_PRESET == 20)
				#define FXAA_QUALITY_PS 3
				#define FXAA_QUALITY_P0 1.5
				#define FXAA_QUALITY_P1 2.0
				#define FXAA_QUALITY_P2 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 21)
				#define FXAA_QUALITY_PS 4
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 22)
				#define FXAA_QUALITY_PS 5
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 23)
				#define FXAA_QUALITY_PS 6
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 24)
				#define FXAA_QUALITY_PS 7
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 3.0
				#define FXAA_QUALITY_P6 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 25)
				#define FXAA_QUALITY_PS 8
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 2.0
				#define FXAA_QUALITY_P6 4.0
				#define FXAA_QUALITY_P7 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 26)
				#define FXAA_QUALITY_PS 9
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 2.0
				#define FXAA_QUALITY_P6 2.0
				#define FXAA_QUALITY_P7 4.0
				#define FXAA_QUALITY_P8 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 27)
				#define FXAA_QUALITY_PS 10
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 2.0
				#define FXAA_QUALITY_P6 2.0
				#define FXAA_QUALITY_P7 2.0
				#define FXAA_QUALITY_P8 4.0
				#define FXAA_QUALITY_P9 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 28)
				#define FXAA_QUALITY_PS 11
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 2.0
				#define FXAA_QUALITY_P6 2.0
				#define FXAA_QUALITY_P7 2.0
				#define FXAA_QUALITY_P8 2.0
				#define FXAA_QUALITY_P9 4.0
				#define FXAA_QUALITY_P10 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 29)
				#define FXAA_QUALITY_PS 12
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 2.0
				#define FXAA_QUALITY_P6 2.0
				#define FXAA_QUALITY_P7 2.0
				#define FXAA_QUALITY_P8 2.0
				#define FXAA_QUALITY_P9 2.0
				#define FXAA_QUALITY_P10 4.0
				#define FXAA_QUALITY_P11 8.0
		#endif

		/*============================================================================
												 FXAA QUALITY - EXTREME QUALITY
		============================================================================*/
		#if (FXAA_QUALITY_PRESET == 39)
				#define FXAA_QUALITY_PS 12
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.0
				#define FXAA_QUALITY_P2 1.0
				#define FXAA_QUALITY_P3 1.0
				#define FXAA_QUALITY_P4 1.0
				#define FXAA_QUALITY_P5 1.5
				#define FXAA_QUALITY_P6 2.0
				#define FXAA_QUALITY_P7 2.0
				#define FXAA_QUALITY_P8 2.0
				#define FXAA_QUALITY_P9 2.0
				#define FXAA_QUALITY_P10 4.0
				#define FXAA_QUALITY_P11 8.0
		#endif



		/*============================================================================

																		API PORTING

		============================================================================*/
		#if (FXAA_GLSL_100 == 1) || (FXAA_GLSL_120 == 1) || (FXAA_GLSL_130 == 1)
				#define FxaaBool bool
				#define FxaaDiscard discard
				#define FxaaFloat float
				#define FxaaFloat2 vec2
				#define FxaaFloat3 vec3
				#define FxaaFloat4 vec4
				#define FxaaHalf float
				#define FxaaHalf2 vec2
				#define FxaaHalf3 vec3
				#define FxaaHalf4 vec4
				#define FxaaInt2 ivec2
				#define FxaaSat(x) clamp(x, 0.0, 1.0)
				#define FxaaTex sampler2D
		#else
				#define FxaaBool bool
				#define FxaaDiscard clip(-1)
				#define FxaaFloat float
				#define FxaaFloat2 float2
				#define FxaaFloat3 float3
				#define FxaaFloat4 float4
				#define FxaaHalf half
				#define FxaaHalf2 half2
				#define FxaaHalf3 half3
				#define FxaaHalf4 half4
				#define FxaaSat(x) saturate(x)
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_GLSL_100 == 1)
			#define FxaaTexTop(t, p) texture2D(t, p, 0.0)
			#define FxaaTexOff(t, p, o, r) texture2D(t, p + (o * r), 0.0)
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_GLSL_120 == 1)
				// Requires,
				//	#version 120
				// And at least,
				//	#extension GL_EXT_gpu_shader4 : enable
				//	(or set FXAA_FAST_PIXEL_OFFSET 1 to work like DX9)
				#define FxaaTexTop(t, p) texture2DLod(t, p, 0.0)
				#if (FXAA_FAST_PIXEL_OFFSET == 1)
						#define FxaaTexOff(t, p, o, r) texture2DLodOffset(t, p, 0.0, o)
				#else
						#define FxaaTexOff(t, p, o, r) texture2DLod(t, p + (o * r), 0.0)
				#endif
				#if (FXAA_GATHER4_ALPHA == 1)
						// use #extension GL_ARB_gpu_shader5 : enable
						#define FxaaTexAlpha4(t, p) textureGather(t, p, 3)
						#define FxaaTexOffAlpha4(t, p, o) textureGatherOffset(t, p, o, 3)
						#define FxaaTexGreen4(t, p) textureGather(t, p, 1)
						#define FxaaTexOffGreen4(t, p, o) textureGatherOffset(t, p, o, 1)
				#endif
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_GLSL_130 == 1)
				// Requires "#version 130" or better
				#define FxaaTexTop(t, p) textureLod(t, p, 0.0)
				#define FxaaTexOff(t, p, o, r) textureLodOffset(t, p, 0.0, o)
				#if (FXAA_GATHER4_ALPHA == 1)
						// use #extension GL_ARB_gpu_shader5 : enable
						#define FxaaTexAlpha4(t, p) textureGather(t, p, 3)
						#define FxaaTexOffAlpha4(t, p, o) textureGatherOffset(t, p, o, 3)
						#define FxaaTexGreen4(t, p) textureGather(t, p, 1)
						#define FxaaTexOffGreen4(t, p, o) textureGatherOffset(t, p, o, 1)
				#endif
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_HLSL_3 == 1)
				#define FxaaInt2 float2
				#define FxaaTex sampler2D
				#define FxaaTexTop(t, p) tex2Dlod(t, float4(p, 0.0, 0.0))
				#define FxaaTexOff(t, p, o, r) tex2Dlod(t, float4(p + (o * r), 0, 0))
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_HLSL_4 == 1)
				#define FxaaInt2 int2
				struct FxaaTex { SamplerState smpl; Texture2D tex; };
				#define FxaaTexTop(t, p) t.tex.SampleLevel(t.smpl, p, 0.0)
				#define FxaaTexOff(t, p, o, r) t.tex.SampleLevel(t.smpl, p, 0.0, o)
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_HLSL_5 == 1)
				#define FxaaInt2 int2
				struct FxaaTex { SamplerState smpl; Texture2D tex; };
				#define FxaaTexTop(t, p) t.tex.SampleLevel(t.smpl, p, 0.0)
				#define FxaaTexOff(t, p, o, r) t.tex.SampleLevel(t.smpl, p, 0.0, o)
				#define FxaaTexAlpha4(t, p) t.tex.GatherAlpha(t.smpl, p)
				#define FxaaTexOffAlpha4(t, p, o) t.tex.GatherAlpha(t.smpl, p, o)
				#define FxaaTexGreen4(t, p) t.tex.GatherGreen(t.smpl, p)
				#define FxaaTexOffGreen4(t, p, o) t.tex.GatherGreen(t.smpl, p, o)
		#endif


		/*============================================================================
											 GREEN AS LUMA OPTION SUPPORT FUNCTION
		============================================================================*/
		#if (FXAA_GREEN_AS_LUMA == 0)
				FxaaFloat FxaaLuma(FxaaFloat4 rgba) { return rgba.w; }
		#else
				FxaaFloat FxaaLuma(FxaaFloat4 rgba) { return rgba.y; }
		#endif




		/*============================================================================

																 FXAA3 QUALITY - PC

		============================================================================*/
		#if (FXAA_PC == 1)
		/*--------------------------------------------------------------------------*/
		FxaaFloat4 FxaaPixelShader(
				//
				// Use noperspective interpolation here (turn off perspective interpolation).
				// {xy} = center of pixel
				FxaaFloat2 pos,
				//
				// Used only for FXAA Console, and not used on the 360 version.
				// Use noperspective interpolation here (turn off perspective interpolation).
				// {xy_} = upper left of pixel
				// {_zw} = lower right of pixel
				FxaaFloat4 fxaaConsolePosPos,
				//
				// Input color texture.
				// {rgb_} = color in linear or perceptual color space
				// if (FXAA_GREEN_AS_LUMA == 0)
				//		 {__a} = luma in perceptual color space (not linear)
				FxaaTex tex,
				//
				// Only used on the optimized 360 version of FXAA Console.
				// For everything but 360, just use the same input here as for "tex".
				// For 360, same texture, just alias with a 2nd sampler.
				// This sampler needs to have an exponent bias of -1.
				FxaaTex fxaaConsole360TexExpBiasNegOne,
				//
				// Only used on the optimized 360 version of FXAA Console.
				// For everything but 360, just use the same input here as for "tex".
				// For 360, same texture, just alias with a 3nd sampler.
				// This sampler needs to have an exponent bias of -2.
				FxaaTex fxaaConsole360TexExpBiasNegTwo,
				//
				// Only used on FXAA Quality.
				// This must be from a constant/uniform.
				// {x_} = 1.0/screenWidthInPixels
				// {_y} = 1.0/screenHeightInPixels
				FxaaFloat2 fxaaQualityRcpFrame,
				//
				// Only used on FXAA Console.
				// This must be from a constant/uniform.
				// This effects sub-pixel AA quality and inversely sharpness.
				//	 Where N ranges between,
				//		 N = 0.50 (default)
				//		 N = 0.33 (sharper)
				// {x__} = -N/screenWidthInPixels
				// {_y_} = -N/screenHeightInPixels
				// {_z_} =	N/screenWidthInPixels
				// {__w} =	N/screenHeightInPixels
				FxaaFloat4 fxaaConsoleRcpFrameOpt,
				//
				// Only used on FXAA Console.
				// Not used on 360, but used on PS3 and PC.
				// This must be from a constant/uniform.
				// {x__} = -2.0/screenWidthInPixels
				// {_y_} = -2.0/screenHeightInPixels
				// {_z_} =	2.0/screenWidthInPixels
				// {__w} =	2.0/screenHeightInPixels
				FxaaFloat4 fxaaConsoleRcpFrameOpt2,
				//
				// Only used on FXAA Console.
				// Only used on 360 in place of fxaaConsoleRcpFrameOpt2.
				// This must be from a constant/uniform.
				// {x__} =	8.0/screenWidthInPixels
				// {_y_} =	8.0/screenHeightInPixels
				// {_z_} = -4.0/screenWidthInPixels
				// {__w} = -4.0/screenHeightInPixels
				FxaaFloat4 fxaaConsole360RcpFrameOpt2,
				//
				// Only used on FXAA Quality.
				// This used to be the FXAA_QUALITY_SUBPIX define.
				// It is here now to allow easier tuning.
				// Choose the amount of sub-pixel aliasing removal.
				// This can effect sharpness.
				//	 1.00 - upper limit (softer)
				//	 0.75 - default amount of filtering
				//	 0.50 - lower limit (sharper, less sub-pixel aliasing removal)
				//	 0.25 - almost off
				//	 0.00 - completely off
				FxaaFloat fxaaQualitySubpix,
				//
				// Only used on FXAA Quality.
				// This used to be the FXAA_QUALITY_EDGE_THRESHOLD define.
				// It is here now to allow easier tuning.
				// The minimum amount of local contrast required to apply algorithm.
				//	 0.333 - too little (faster)
				//	 0.250 - low quality
				//	 0.166 - default
				//	 0.125 - high quality
				//	 0.063 - overkill (slower)
				FxaaFloat fxaaQualityEdgeThreshold,
				//
				// Only used on FXAA Quality.
				// This used to be the FXAA_QUALITY_EDGE_THRESHOLD_MIN define.
				// It is here now to allow easier tuning.
				// Trims the algorithm from processing darks.
				//	 0.0833 - upper limit (default, the start of visible unfiltered edges)
				//	 0.0625 - high quality (faster)
				//	 0.0312 - visible limit (slower)
				// Special notes when using FXAA_GREEN_AS_LUMA,
				//	 Likely want to set this to zero.
				//	 As colors that are mostly not-green
				//	 will appear very dark in the green channel!
				//	 Tune by looking at mostly non-green content,
				//	 then start at zero and increase until aliasing is a problem.
				FxaaFloat fxaaQualityEdgeThresholdMin,
				//
				// Only used on FXAA Console.
				// This used to be the FXAA_CONSOLE_EDGE_SHARPNESS define.
				// It is here now to allow easier tuning.
				// This does not effect PS3, as this needs to be compiled in.
				//	 Use FXAA_CONSOLE_PS3_EDGE_SHARPNESS for PS3.
				//	 Due to the PS3 being ALU bound,
				//	 there are only three safe values here: 2 and 4 and 8.
				//	 These options use the shaders ability to a free *|/ by 2|4|8.
				// For all other platforms can be a non-power of two.
				//	 8.0 is sharper (default!!!)
				//	 4.0 is softer
				//	 2.0 is really soft (good only for vector graphics inputs)
				FxaaFloat fxaaConsoleEdgeSharpness,
				//
				// Only used on FXAA Console.
				// This used to be the FXAA_CONSOLE_EDGE_THRESHOLD define.
				// It is here now to allow easier tuning.
				// This does not effect PS3, as this needs to be compiled in.
				//	 Use FXAA_CONSOLE_PS3_EDGE_THRESHOLD for PS3.
				//	 Due to the PS3 being ALU bound,
				//	 there are only two safe values here: 1/4 and 1/8.
				//	 These options use the shaders ability to a free *|/ by 2|4|8.
				// The console setting has a different mapping than the quality setting.
				// Other platforms can use other values.
				//	 0.125 leaves less aliasing, but is softer (default!!!)
				//	 0.25 leaves more aliasing, and is sharper
				FxaaFloat fxaaConsoleEdgeThreshold,
				//
				// Only used on FXAA Console.
				// This used to be the FXAA_CONSOLE_EDGE_THRESHOLD_MIN define.
				// It is here now to allow easier tuning.
				// Trims the algorithm from processing darks.
				// The console setting has a different mapping than the quality setting.
				// This only applies when FXAA_EARLY_EXIT is 1.
				// This does not apply to PS3,
				// PS3 was simplified to avoid more shader instructions.
				//	 0.06 - faster but more aliasing in darks
				//	 0.05 - default
				//	 0.04 - slower and less aliasing in darks
				// Special notes when using FXAA_GREEN_AS_LUMA,
				//	 Likely want to set this to zero.
				//	 As colors that are mostly not-green
				//	 will appear very dark in the green channel!
				//	 Tune by looking at mostly non-green content,
				//	 then start at zero and increase until aliasing is a problem.
				FxaaFloat fxaaConsoleEdgeThresholdMin,
				//
				// Extra constants for 360 FXAA Console only.
				// Use zeros or anything else for other platforms.
				// These must be in physical constant registers and NOT immediates.
				// Immediates will result in compiler un-optimizing.
				// {xyzw} = float4(1.0, -1.0, 0.25, -0.25)
				FxaaFloat4 fxaaConsole360ConstDir
		) {
		/*--------------------------------------------------------------------------*/
				FxaaFloat2 posM;
				posM.x = pos.x;
				posM.y = pos.y;
				#if (FXAA_GATHER4_ALPHA == 1)
						#if (FXAA_DISCARD == 0)
								FxaaFloat4 rgbyM = FxaaTexTop(tex, posM);
								#if (FXAA_GREEN_AS_LUMA == 0)
										#define lumaM rgbyM.w
								#else
										#define lumaM rgbyM.y
								#endif
						#endif
						#if (FXAA_GREEN_AS_LUMA == 0)
								FxaaFloat4 luma4A = FxaaTexAlpha4(tex, posM);
								FxaaFloat4 luma4B = FxaaTexOffAlpha4(tex, posM, FxaaInt2(-1, -1));
						#else
								FxaaFloat4 luma4A = FxaaTexGreen4(tex, posM);
								FxaaFloat4 luma4B = FxaaTexOffGreen4(tex, posM, FxaaInt2(-1, -1));
						#endif
						#if (FXAA_DISCARD == 1)
								#define lumaM luma4A.w
						#endif
						#define lumaE luma4A.z
						#define lumaS luma4A.x
						#define lumaSE luma4A.y
						#define lumaNW luma4B.w
						#define lumaN luma4B.z
						#define lumaW luma4B.x
				#else
						FxaaFloat4 rgbyM = FxaaTexTop(tex, posM);
						#if (FXAA_GREEN_AS_LUMA == 0)
								#define lumaM rgbyM.w
						#else
								#define lumaM rgbyM.y
						#endif
						#if (FXAA_GLSL_100 == 1)
							FxaaFloat lumaS = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2( 0.0, 1.0), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaE = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2( 1.0, 0.0), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaN = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2( 0.0,-1.0), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaW = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2(-1.0, 0.0), fxaaQualityRcpFrame.xy));
						#else
							FxaaFloat lumaS = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2( 0, 1), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaE = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2( 1, 0), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaN = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2( 0,-1), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaW = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2(-1, 0), fxaaQualityRcpFrame.xy));
						#endif
				#endif
		/*--------------------------------------------------------------------------*/
				FxaaFloat maxSM = max(lumaS, lumaM);
				FxaaFloat minSM = min(lumaS, lumaM);
				FxaaFloat maxESM = max(lumaE, maxSM);
				FxaaFloat minESM = min(lumaE, minSM);
				FxaaFloat maxWN = max(lumaN, lumaW);
				FxaaFloat minWN = min(lumaN, lumaW);
				FxaaFloat rangeMax = max(maxWN, maxESM);
				FxaaFloat rangeMin = min(minWN, minESM);
				FxaaFloat rangeMaxScaled = rangeMax * fxaaQualityEdgeThreshold;
				FxaaFloat range = rangeMax - rangeMin;
				FxaaFloat rangeMaxClamped = max(fxaaQualityEdgeThresholdMin, rangeMaxScaled);
				FxaaBool earlyExit = range < rangeMaxClamped;
		/*--------------------------------------------------------------------------*/
				if(earlyExit)
						#if (FXAA_DISCARD == 1)
								FxaaDiscard;
						#else
								return rgbyM;
						#endif
		/*--------------------------------------------------------------------------*/
				#if (FXAA_GATHER4_ALPHA == 0)
						#if (FXAA_GLSL_100 == 1)
							FxaaFloat lumaNW = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2(-1.0,-1.0), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaSE = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2( 1.0, 1.0), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaNE = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2( 1.0,-1.0), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaSW = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2(-1.0, 1.0), fxaaQualityRcpFrame.xy));
						#else
							FxaaFloat lumaNW = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2(-1,-1), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaSE = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2( 1, 1), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaNE = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2( 1,-1), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaSW = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2(-1, 1), fxaaQualityRcpFrame.xy));
						#endif
				#else
						FxaaFloat lumaNE = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2(1, -1), fxaaQualityRcpFrame.xy));
						FxaaFloat lumaSW = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2(-1, 1), fxaaQualityRcpFrame.xy));
				#endif
		/*--------------------------------------------------------------------------*/
				FxaaFloat lumaNS = lumaN + lumaS;
				FxaaFloat lumaWE = lumaW + lumaE;
				FxaaFloat subpixRcpRange = 1.0/range;
				FxaaFloat subpixNSWE = lumaNS + lumaWE;
				FxaaFloat edgeHorz1 = (-2.0 * lumaM) + lumaNS;
				FxaaFloat edgeVert1 = (-2.0 * lumaM) + lumaWE;
		/*--------------------------------------------------------------------------*/
				FxaaFloat lumaNESE = lumaNE + lumaSE;
				FxaaFloat lumaNWNE = lumaNW + lumaNE;
				FxaaFloat edgeHorz2 = (-2.0 * lumaE) + lumaNESE;
				FxaaFloat edgeVert2 = (-2.0 * lumaN) + lumaNWNE;
		/*--------------------------------------------------------------------------*/
				FxaaFloat lumaNWSW = lumaNW + lumaSW;
				FxaaFloat lumaSWSE = lumaSW + lumaSE;
				FxaaFloat edgeHorz4 = (abs(edgeHorz1) * 2.0) + abs(edgeHorz2);
				FxaaFloat edgeVert4 = (abs(edgeVert1) * 2.0) + abs(edgeVert2);
				FxaaFloat edgeHorz3 = (-2.0 * lumaW) + lumaNWSW;
				FxaaFloat edgeVert3 = (-2.0 * lumaS) + lumaSWSE;
				FxaaFloat edgeHorz = abs(edgeHorz3) + edgeHorz4;
				FxaaFloat edgeVert = abs(edgeVert3) + edgeVert4;
		/*--------------------------------------------------------------------------*/
				FxaaFloat subpixNWSWNESE = lumaNWSW + lumaNESE;
				FxaaFloat lengthSign = fxaaQualityRcpFrame.x;
				FxaaBool horzSpan = edgeHorz >= edgeVert;
				FxaaFloat subpixA = subpixNSWE * 2.0 + subpixNWSWNESE;
		/*--------------------------------------------------------------------------*/
				if(!horzSpan) lumaN = lumaW;
				if(!horzSpan) lumaS = lumaE;
				if(horzSpan) lengthSign = fxaaQualityRcpFrame.y;
				FxaaFloat subpixB = (subpixA * (1.0/12.0)) - lumaM;
		/*--------------------------------------------------------------------------*/
				FxaaFloat gradientN = lumaN - lumaM;
				FxaaFloat gradientS = lumaS - lumaM;
				FxaaFloat lumaNN = lumaN + lumaM;
				FxaaFloat lumaSS = lumaS + lumaM;
				FxaaBool pairN = abs(gradientN) >= abs(gradientS);
				FxaaFloat gradient = max(abs(gradientN), abs(gradientS));
				if(pairN) lengthSign = -lengthSign;
				FxaaFloat subpixC = FxaaSat(abs(subpixB) * subpixRcpRange);
		/*--------------------------------------------------------------------------*/
				FxaaFloat2 posB;
				posB.x = posM.x;
				posB.y = posM.y;
				FxaaFloat2 offNP;
				offNP.x = (!horzSpan) ? 0.0 : fxaaQualityRcpFrame.x;
				offNP.y = ( horzSpan) ? 0.0 : fxaaQualityRcpFrame.y;
				if(!horzSpan) posB.x += lengthSign * 0.5;
				if( horzSpan) posB.y += lengthSign * 0.5;
		/*--------------------------------------------------------------------------*/
				FxaaFloat2 posN;
				posN.x = posB.x - offNP.x * FXAA_QUALITY_P0;
				posN.y = posB.y - offNP.y * FXAA_QUALITY_P0;
				FxaaFloat2 posP;
				posP.x = posB.x + offNP.x * FXAA_QUALITY_P0;
				posP.y = posB.y + offNP.y * FXAA_QUALITY_P0;
				FxaaFloat subpixD = ((-2.0)*subpixC) + 3.0;
				FxaaFloat lumaEndN = FxaaLuma(FxaaTexTop(tex, posN));
				FxaaFloat subpixE = subpixC * subpixC;
				FxaaFloat lumaEndP = FxaaLuma(FxaaTexTop(tex, posP));
		/*--------------------------------------------------------------------------*/
				if(!pairN) lumaNN = lumaSS;
				FxaaFloat gradientScaled = gradient * 1.0/4.0;
				FxaaFloat lumaMM = lumaM - lumaNN * 0.5;
				FxaaFloat subpixF = subpixD * subpixE;
				FxaaBool lumaMLTZero = lumaMM < 0.0;
		/*--------------------------------------------------------------------------*/
				lumaEndN -= lumaNN * 0.5;
				lumaEndP -= lumaNN * 0.5;
				FxaaBool doneN = abs(lumaEndN) >= gradientScaled;
				FxaaBool doneP = abs(lumaEndP) >= gradientScaled;
				if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P1;
				if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P1;
				FxaaBool doneNP = (!doneN) || (!doneP);
				if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P1;
				if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P1;
		/*--------------------------------------------------------------------------*/
				if(doneNP) {
						if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
						if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
						if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
						if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
						doneN = abs(lumaEndN) >= gradientScaled;
						doneP = abs(lumaEndP) >= gradientScaled;
						if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P2;
						if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P2;
						doneNP = (!doneN) || (!doneP);
						if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P2;
						if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P2;
		/*--------------------------------------------------------------------------*/
						#if (FXAA_QUALITY_PS > 3)
						if(doneNP) {
								if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
								if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
								if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
								if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
								doneN = abs(lumaEndN) >= gradientScaled;
								doneP = abs(lumaEndP) >= gradientScaled;
								if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P3;
								if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P3;
								doneNP = (!doneN) || (!doneP);
								if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P3;
								if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P3;
		/*--------------------------------------------------------------------------*/
								#if (FXAA_QUALITY_PS > 4)
								if(doneNP) {
										if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
										if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
										if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
										if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
										doneN = abs(lumaEndN) >= gradientScaled;
										doneP = abs(lumaEndP) >= gradientScaled;
										if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P4;
										if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P4;
										doneNP = (!doneN) || (!doneP);
										if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P4;
										if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P4;
		/*--------------------------------------------------------------------------*/
										#if (FXAA_QUALITY_PS > 5)
										if(doneNP) {
												if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
												if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
												if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
												if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
												doneN = abs(lumaEndN) >= gradientScaled;
												doneP = abs(lumaEndP) >= gradientScaled;
												if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P5;
												if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P5;
												doneNP = (!doneN) || (!doneP);
												if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P5;
												if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P5;
		/*--------------------------------------------------------------------------*/
												#if (FXAA_QUALITY_PS > 6)
												if(doneNP) {
														if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
														if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
														if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
														if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
														doneN = abs(lumaEndN) >= gradientScaled;
														doneP = abs(lumaEndP) >= gradientScaled;
														if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P6;
														if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P6;
														doneNP = (!doneN) || (!doneP);
														if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P6;
														if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P6;
		/*--------------------------------------------------------------------------*/
														#if (FXAA_QUALITY_PS > 7)
														if(doneNP) {
																if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
																if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
																if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
																if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
																doneN = abs(lumaEndN) >= gradientScaled;
																doneP = abs(lumaEndP) >= gradientScaled;
																if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P7;
																if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P7;
																doneNP = (!doneN) || (!doneP);
																if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P7;
																if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P7;
		/*--------------------------------------------------------------------------*/
				#if (FXAA_QUALITY_PS > 8)
				if(doneNP) {
						if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
						if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
						if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
						if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
						doneN = abs(lumaEndN) >= gradientScaled;
						doneP = abs(lumaEndP) >= gradientScaled;
						if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P8;
						if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P8;
						doneNP = (!doneN) || (!doneP);
						if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P8;
						if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P8;
		/*--------------------------------------------------------------------------*/
						#if (FXAA_QUALITY_PS > 9)
						if(doneNP) {
								if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
								if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
								if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
								if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
								doneN = abs(lumaEndN) >= gradientScaled;
								doneP = abs(lumaEndP) >= gradientScaled;
								if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P9;
								if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P9;
								doneNP = (!doneN) || (!doneP);
								if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P9;
								if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P9;
		/*--------------------------------------------------------------------------*/
								#if (FXAA_QUALITY_PS > 10)
								if(doneNP) {
										if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
										if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
										if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
										if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
										doneN = abs(lumaEndN) >= gradientScaled;
										doneP = abs(lumaEndP) >= gradientScaled;
										if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P10;
										if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P10;
										doneNP = (!doneN) || (!doneP);
										if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P10;
										if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P10;
		/*--------------------------------------------------------------------------*/
										#if (FXAA_QUALITY_PS > 11)
										if(doneNP) {
												if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
												if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
												if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
												if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
												doneN = abs(lumaEndN) >= gradientScaled;
												doneP = abs(lumaEndP) >= gradientScaled;
												if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P11;
												if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P11;
												doneNP = (!doneN) || (!doneP);
												if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P11;
												if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P11;
		/*--------------------------------------------------------------------------*/
												#if (FXAA_QUALITY_PS > 12)
												if(doneNP) {
														if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
														if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
														if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
														if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
														doneN = abs(lumaEndN) >= gradientScaled;
														doneP = abs(lumaEndP) >= gradientScaled;
														if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P12;
														if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P12;
														doneNP = (!doneN) || (!doneP);
														if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P12;
														if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P12;
		/*--------------------------------------------------------------------------*/
												}
												#endif
		/*--------------------------------------------------------------------------*/
										}
										#endif
		/*--------------------------------------------------------------------------*/
								}
								#endif
		/*--------------------------------------------------------------------------*/
						}
						#endif
		/*--------------------------------------------------------------------------*/
				}
				#endif
		/*--------------------------------------------------------------------------*/
														}
														#endif
		/*--------------------------------------------------------------------------*/
												}
												#endif
		/*--------------------------------------------------------------------------*/
										}
										#endif
		/*--------------------------------------------------------------------------*/
								}
								#endif
		/*--------------------------------------------------------------------------*/
						}
						#endif
		/*--------------------------------------------------------------------------*/
				}
		/*--------------------------------------------------------------------------*/
				FxaaFloat dstN = posM.x - posN.x;
				FxaaFloat dstP = posP.x - posM.x;
				if(!horzSpan) dstN = posM.y - posN.y;
				if(!horzSpan) dstP = posP.y - posM.y;
		/*--------------------------------------------------------------------------*/
				FxaaBool goodSpanN = (lumaEndN < 0.0) != lumaMLTZero;
				FxaaFloat spanLength = (dstP + dstN);
				FxaaBool goodSpanP = (lumaEndP < 0.0) != lumaMLTZero;
				FxaaFloat spanLengthRcp = 1.0/spanLength;
		/*--------------------------------------------------------------------------*/
				FxaaBool directionN = dstN < dstP;
				FxaaFloat dst = min(dstN, dstP);
				FxaaBool goodSpan = directionN ? goodSpanN : goodSpanP;
				FxaaFloat subpixG = subpixF * subpixF;
				FxaaFloat pixelOffset = (dst * (-spanLengthRcp)) + 0.5;
				FxaaFloat subpixH = subpixG * fxaaQualitySubpix;
		/*--------------------------------------------------------------------------*/
				FxaaFloat pixelOffsetGood = goodSpan ? pixelOffset : 0.0;
				FxaaFloat pixelOffsetSubpix = max(pixelOffsetGood, subpixH);
				if(!horzSpan) posM.x += pixelOffsetSubpix * lengthSign;
				if( horzSpan) posM.y += pixelOffsetSubpix * lengthSign;
				#if (FXAA_DISCARD == 1)
						return FxaaTexTop(tex, posM);
				#else
						return FxaaFloat4(FxaaTexTop(tex, posM).xyz, lumaM);
				#endif
		}
		/*==========================================================================*/
		#endif

		void main() {
			gl_FragColor = FxaaPixelShader(
				vUv,
				vec4(0.0),
				tDiffuse,
				tDiffuse,
				tDiffuse,
				resolution,
				vec4(0.0),
				vec4(0.0),
				vec4(0.0),
				0.75,
				0.166,
				0.0833,
				0.0,
				0.0,
				0.0,
				vec4(0.0)
			);

			// TODO avoid querying texture twice for same texel
			gl_FragColor.a = texture2D(tDiffuse, vUv).a;
		}`
	};

	THREE.FXAAShader = FXAAShader;

} )();

/* ---- math/SimplexNoise.js ---- */
( function () {

	// Ported from Stefan Gustavson's java implementation
	// http://staffwww.itn.liu.se/~stegu/simplexnoise/simplexnoise.pdf
	// Read Stefan's excellent paper for details on how this code works.
	//
	// Sean McCullough banksean@gmail.com
	//
	// Added 4D noise

	/**
 * You can pass in a random number generator object if you like.
 * It is assumed to have a random() method.
 */
	class SimplexNoise {

		constructor( r = Math ) {

			this.grad3 = [[ 1, 1, 0 ], [ - 1, 1, 0 ], [ 1, - 1, 0 ], [ - 1, - 1, 0 ], [ 1, 0, 1 ], [ - 1, 0, 1 ], [ 1, 0, - 1 ], [ - 1, 0, - 1 ], [ 0, 1, 1 ], [ 0, - 1, 1 ], [ 0, 1, - 1 ], [ 0, - 1, - 1 ]];
			this.grad4 = [[ 0, 1, 1, 1 ], [ 0, 1, 1, - 1 ], [ 0, 1, - 1, 1 ], [ 0, 1, - 1, - 1 ], [ 0, - 1, 1, 1 ], [ 0, - 1, 1, - 1 ], [ 0, - 1, - 1, 1 ], [ 0, - 1, - 1, - 1 ], [ 1, 0, 1, 1 ], [ 1, 0, 1, - 1 ], [ 1, 0, - 1, 1 ], [ 1, 0, - 1, - 1 ], [ - 1, 0, 1, 1 ], [ - 1, 0, 1, - 1 ], [ - 1, 0, - 1, 1 ], [ - 1, 0, - 1, - 1 ], [ 1, 1, 0, 1 ], [ 1, 1, 0, - 1 ], [ 1, - 1, 0, 1 ], [ 1, - 1, 0, - 1 ], [ - 1, 1, 0, 1 ], [ - 1, 1, 0, - 1 ], [ - 1, - 1, 0, 1 ], [ - 1, - 1, 0, - 1 ], [ 1, 1, 1, 0 ], [ 1, 1, - 1, 0 ], [ 1, - 1, 1, 0 ], [ 1, - 1, - 1, 0 ], [ - 1, 1, 1, 0 ], [ - 1, 1, - 1, 0 ], [ - 1, - 1, 1, 0 ], [ - 1, - 1, - 1, 0 ]];
			this.p = [];

			for ( let i = 0; i < 256; i ++ ) {

				this.p[ i ] = Math.floor( r.random() * 256 );

			} // To remove the need for index wrapping, double the permutation table length


			this.perm = [];

			for ( let i = 0; i < 512; i ++ ) {

				this.perm[ i ] = this.p[ i & 255 ];

			} // A lookup table to traverse the simplex around a given point in 4D.
			// Details can be found where this table is used, in the 4D noise method.


			this.simplex = [[ 0, 1, 2, 3 ], [ 0, 1, 3, 2 ], [ 0, 0, 0, 0 ], [ 0, 2, 3, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 1, 2, 3, 0 ], [ 0, 2, 1, 3 ], [ 0, 0, 0, 0 ], [ 0, 3, 1, 2 ], [ 0, 3, 2, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 1, 3, 2, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 1, 2, 0, 3 ], [ 0, 0, 0, 0 ], [ 1, 3, 0, 2 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 2, 3, 0, 1 ], [ 2, 3, 1, 0 ], [ 1, 0, 2, 3 ], [ 1, 0, 3, 2 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 2, 0, 3, 1 ], [ 0, 0, 0, 0 ], [ 2, 1, 3, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 2, 0, 1, 3 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 3, 0, 1, 2 ], [ 3, 0, 2, 1 ], [ 0, 0, 0, 0 ], [ 3, 1, 2, 0 ], [ 2, 1, 0, 3 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 3, 1, 0, 2 ], [ 0, 0, 0, 0 ], [ 3, 2, 0, 1 ], [ 3, 2, 1, 0 ]];

		}

		dot( g, x, y ) {

			return g[ 0 ] * x + g[ 1 ] * y;

		}

		dot3( g, x, y, z ) {

			return g[ 0 ] * x + g[ 1 ] * y + g[ 2 ] * z;

		}

		dot4( g, x, y, z, w ) {

			return g[ 0 ] * x + g[ 1 ] * y + g[ 2 ] * z + g[ 3 ] * w;

		}

		noise( xin, yin ) {

			let n0; // Noise contributions from the three corners

			let n1;
			let n2; // Skew the input space to determine which simplex cell we're in

			const F2 = 0.5 * ( Math.sqrt( 3.0 ) - 1.0 );
			const s = ( xin + yin ) * F2; // Hairy factor for 2D

			const i = Math.floor( xin + s );
			const j = Math.floor( yin + s );
			const G2 = ( 3.0 - Math.sqrt( 3.0 ) ) / 6.0;
			const t = ( i + j ) * G2;
			const X0 = i - t; // Unskew the cell origin back to (x,y) space

			const Y0 = j - t;
			const x0 = xin - X0; // The x,y distances from the cell origin

			const y0 = yin - Y0; // For the 2D case, the simplex shape is an equilateral triangle.
			// Determine which simplex we are in.

			let i1; // Offsets for second (middle) corner of simplex in (i,j) coords

			let j1;

			if ( x0 > y0 ) {

				i1 = 1;
				j1 = 0; // lower triangle, XY order: (0,0)->(1,0)->(1,1)

			} else {

				i1 = 0;
				j1 = 1;

			} // upper triangle, YX order: (0,0)->(0,1)->(1,1)
			// A step of (1,0) in (i,j) means a step of (1-c,-c) in (x,y), and
			// a step of (0,1) in (i,j) means a step of (-c,1-c) in (x,y), where
			// c = (3-sqrt(3))/6


			const x1 = x0 - i1 + G2; // Offsets for middle corner in (x,y) unskewed coords

			const y1 = y0 - j1 + G2;
			const x2 = x0 - 1.0 + 2.0 * G2; // Offsets for last corner in (x,y) unskewed coords

			const y2 = y0 - 1.0 + 2.0 * G2; // Work out the hashed gradient indices of the three simplex corners

			const ii = i & 255;
			const jj = j & 255;
			const gi0 = this.perm[ ii + this.perm[ jj ] ] % 12;
			const gi1 = this.perm[ ii + i1 + this.perm[ jj + j1 ] ] % 12;
			const gi2 = this.perm[ ii + 1 + this.perm[ jj + 1 ] ] % 12; // Calculate the contribution from the three corners

			let t0 = 0.5 - x0 * x0 - y0 * y0;
			if ( t0 < 0 ) n0 = 0.0; else {

				t0 *= t0;
				n0 = t0 * t0 * this.dot( this.grad3[ gi0 ], x0, y0 ); // (x,y) of grad3 used for 2D gradient

			}

			let t1 = 0.5 - x1 * x1 - y1 * y1;
			if ( t1 < 0 ) n1 = 0.0; else {

				t1 *= t1;
				n1 = t1 * t1 * this.dot( this.grad3[ gi1 ], x1, y1 );

			}

			let t2 = 0.5 - x2 * x2 - y2 * y2;
			if ( t2 < 0 ) n2 = 0.0; else {

				t2 *= t2;
				n2 = t2 * t2 * this.dot( this.grad3[ gi2 ], x2, y2 );

			} // Add contributions from each corner to get the final noise value.
			// The result is scaled to return values in the interval [-1,1].

			return 70.0 * ( n0 + n1 + n2 );

		} // 3D simplex noise


		noise3d( xin, yin, zin ) {

			let n0; // Noise contributions from the four corners

			let n1;
			let n2;
			let n3; // Skew the input space to determine which simplex cell we're in

			const F3 = 1.0 / 3.0;
			const s = ( xin + yin + zin ) * F3; // Very nice and simple skew factor for 3D

			const i = Math.floor( xin + s );
			const j = Math.floor( yin + s );
			const k = Math.floor( zin + s );
			const G3 = 1.0 / 6.0; // Very nice and simple unskew factor, too

			const t = ( i + j + k ) * G3;
			const X0 = i - t; // Unskew the cell origin back to (x,y,z) space

			const Y0 = j - t;
			const Z0 = k - t;
			const x0 = xin - X0; // The x,y,z distances from the cell origin

			const y0 = yin - Y0;
			const z0 = zin - Z0; // For the 3D case, the simplex shape is a slightly irregular tetrahedron.
			// Determine which simplex we are in.

			let i1; // Offsets for second corner of simplex in (i,j,k) coords

			let j1;
			let k1;
			let i2; // Offsets for third corner of simplex in (i,j,k) coords

			let j2;
			let k2;

			if ( x0 >= y0 ) {

				if ( y0 >= z0 ) {

					i1 = 1;
					j1 = 0;
					k1 = 0;
					i2 = 1;
					j2 = 1;
					k2 = 0; // X Y Z order

				} else if ( x0 >= z0 ) {

					i1 = 1;
					j1 = 0;
					k1 = 0;
					i2 = 1;
					j2 = 0;
					k2 = 1; // X Z Y order

				} else {

					i1 = 0;
					j1 = 0;
					k1 = 1;
					i2 = 1;
					j2 = 0;
					k2 = 1;

				} // Z X Y order

			} else {

				// x0<y0
				if ( y0 < z0 ) {

					i1 = 0;
					j1 = 0;
					k1 = 1;
					i2 = 0;
					j2 = 1;
					k2 = 1; // Z Y X order

				} else if ( x0 < z0 ) {

					i1 = 0;
					j1 = 1;
					k1 = 0;
					i2 = 0;
					j2 = 1;
					k2 = 1; // Y Z X order

				} else {

					i1 = 0;
					j1 = 1;
					k1 = 0;
					i2 = 1;
					j2 = 1;
					k2 = 0;

				} // Y X Z order

			} // A step of (1,0,0) in (i,j,k) means a step of (1-c,-c,-c) in (x,y,z),
			// a step of (0,1,0) in (i,j,k) means a step of (-c,1-c,-c) in (x,y,z), and
			// a step of (0,0,1) in (i,j,k) means a step of (-c,-c,1-c) in (x,y,z), where
			// c = 1/6.


			const x1 = x0 - i1 + G3; // Offsets for second corner in (x,y,z) coords

			const y1 = y0 - j1 + G3;
			const z1 = z0 - k1 + G3;
			const x2 = x0 - i2 + 2.0 * G3; // Offsets for third corner in (x,y,z) coords

			const y2 = y0 - j2 + 2.0 * G3;
			const z2 = z0 - k2 + 2.0 * G3;
			const x3 = x0 - 1.0 + 3.0 * G3; // Offsets for last corner in (x,y,z) coords

			const y3 = y0 - 1.0 + 3.0 * G3;
			const z3 = z0 - 1.0 + 3.0 * G3; // Work out the hashed gradient indices of the four simplex corners

			const ii = i & 255;
			const jj = j & 255;
			const kk = k & 255;
			const gi0 = this.perm[ ii + this.perm[ jj + this.perm[ kk ] ] ] % 12;
			const gi1 = this.perm[ ii + i1 + this.perm[ jj + j1 + this.perm[ kk + k1 ] ] ] % 12;
			const gi2 = this.perm[ ii + i2 + this.perm[ jj + j2 + this.perm[ kk + k2 ] ] ] % 12;
			const gi3 = this.perm[ ii + 1 + this.perm[ jj + 1 + this.perm[ kk + 1 ] ] ] % 12; // Calculate the contribution from the four corners

			let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
			if ( t0 < 0 ) n0 = 0.0; else {

				t0 *= t0;
				n0 = t0 * t0 * this.dot3( this.grad3[ gi0 ], x0, y0, z0 );

			}

			let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
			if ( t1 < 0 ) n1 = 0.0; else {

				t1 *= t1;
				n1 = t1 * t1 * this.dot3( this.grad3[ gi1 ], x1, y1, z1 );

			}

			let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
			if ( t2 < 0 ) n2 = 0.0; else {

				t2 *= t2;
				n2 = t2 * t2 * this.dot3( this.grad3[ gi2 ], x2, y2, z2 );

			}

			let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
			if ( t3 < 0 ) n3 = 0.0; else {

				t3 *= t3;
				n3 = t3 * t3 * this.dot3( this.grad3[ gi3 ], x3, y3, z3 );

			} // Add contributions from each corner to get the final noise value.
			// The result is scaled to stay just inside [-1,1]

			return 32.0 * ( n0 + n1 + n2 + n3 );

		} // 4D simplex noise


		noise4d( x, y, z, w ) {

			// For faster and easier lookups
			const grad4 = this.grad4;
			const simplex = this.simplex;
			const perm = this.perm; // The skewing and unskewing factors are hairy again for the 4D case

			const F4 = ( Math.sqrt( 5.0 ) - 1.0 ) / 4.0;
			const G4 = ( 5.0 - Math.sqrt( 5.0 ) ) / 20.0;
			let n0; // Noise contributions from the five corners

			let n1;
			let n2;
			let n3;
			let n4; // Skew the (x,y,z,w) space to determine which cell of 24 simplices we're in

			const s = ( x + y + z + w ) * F4; // Factor for 4D skewing

			const i = Math.floor( x + s );
			const j = Math.floor( y + s );
			const k = Math.floor( z + s );
			const l = Math.floor( w + s );
			const t = ( i + j + k + l ) * G4; // Factor for 4D unskewing

			const X0 = i - t; // Unskew the cell origin back to (x,y,z,w) space

			const Y0 = j - t;
			const Z0 = k - t;
			const W0 = l - t;
			const x0 = x - X0; // The x,y,z,w distances from the cell origin

			const y0 = y - Y0;
			const z0 = z - Z0;
			const w0 = w - W0; // For the 4D case, the simplex is a 4D shape I won't even try to describe.
			// To find out which of the 24 possible simplices we're in, we need to
			// determine the magnitude ordering of x0, y0, z0 and w0.
			// The method below is a good way of finding the ordering of x,y,z,w and
			// then find the correct traversal order for the simplex we’re in.
			// First, six pair-wise comparisons are performed between each possible pair
			// of the four coordinates, and the results are used to add up binary bits
			// for an integer index.

			const c1 = x0 > y0 ? 32 : 0;
			const c2 = x0 > z0 ? 16 : 0;
			const c3 = y0 > z0 ? 8 : 0;
			const c4 = x0 > w0 ? 4 : 0;
			const c5 = y0 > w0 ? 2 : 0;
			const c6 = z0 > w0 ? 1 : 0;
			const c = c1 + c2 + c3 + c4 + c5 + c6; // simplex[c] is a 4-vector with the numbers 0, 1, 2 and 3 in some order.
			// Many values of c will never occur, since e.g. x>y>z>w makes x<z, y<w and x<w
			// impossible. Only the 24 indices which have non-zero entries make any sense.
			// We use a thresholding to set the coordinates in turn from the largest magnitude.
			// The number 3 in the "simplex" array is at the position of the largest coordinate.

			const i1 = simplex[ c ][ 0 ] >= 3 ? 1 : 0;
			const j1 = simplex[ c ][ 1 ] >= 3 ? 1 : 0;
			const k1 = simplex[ c ][ 2 ] >= 3 ? 1 : 0;
			const l1 = simplex[ c ][ 3 ] >= 3 ? 1 : 0; // The number 2 in the "simplex" array is at the second largest coordinate.

			const i2 = simplex[ c ][ 0 ] >= 2 ? 1 : 0;
			const j2 = simplex[ c ][ 1 ] >= 2 ? 1 : 0;
			const k2 = simplex[ c ][ 2 ] >= 2 ? 1 : 0;
			const l2 = simplex[ c ][ 3 ] >= 2 ? 1 : 0; // The number 1 in the "simplex" array is at the second smallest coordinate.

			const i3 = simplex[ c ][ 0 ] >= 1 ? 1 : 0;
			const j3 = simplex[ c ][ 1 ] >= 1 ? 1 : 0;
			const k3 = simplex[ c ][ 2 ] >= 1 ? 1 : 0;
			const l3 = simplex[ c ][ 3 ] >= 1 ? 1 : 0; // The fifth corner has all coordinate offsets = 1, so no need to look that up.

			const x1 = x0 - i1 + G4; // Offsets for second corner in (x,y,z,w) coords

			const y1 = y0 - j1 + G4;
			const z1 = z0 - k1 + G4;
			const w1 = w0 - l1 + G4;
			const x2 = x0 - i2 + 2.0 * G4; // Offsets for third corner in (x,y,z,w) coords

			const y2 = y0 - j2 + 2.0 * G4;
			const z2 = z0 - k2 + 2.0 * G4;
			const w2 = w0 - l2 + 2.0 * G4;
			const x3 = x0 - i3 + 3.0 * G4; // Offsets for fourth corner in (x,y,z,w) coords

			const y3 = y0 - j3 + 3.0 * G4;
			const z3 = z0 - k3 + 3.0 * G4;
			const w3 = w0 - l3 + 3.0 * G4;
			const x4 = x0 - 1.0 + 4.0 * G4; // Offsets for last corner in (x,y,z,w) coords

			const y4 = y0 - 1.0 + 4.0 * G4;
			const z4 = z0 - 1.0 + 4.0 * G4;
			const w4 = w0 - 1.0 + 4.0 * G4; // Work out the hashed gradient indices of the five simplex corners

			const ii = i & 255;
			const jj = j & 255;
			const kk = k & 255;
			const ll = l & 255;
			const gi0 = perm[ ii + perm[ jj + perm[ kk + perm[ ll ] ] ] ] % 32;
			const gi1 = perm[ ii + i1 + perm[ jj + j1 + perm[ kk + k1 + perm[ ll + l1 ] ] ] ] % 32;
			const gi2 = perm[ ii + i2 + perm[ jj + j2 + perm[ kk + k2 + perm[ ll + l2 ] ] ] ] % 32;
			const gi3 = perm[ ii + i3 + perm[ jj + j3 + perm[ kk + k3 + perm[ ll + l3 ] ] ] ] % 32;
			const gi4 = perm[ ii + 1 + perm[ jj + 1 + perm[ kk + 1 + perm[ ll + 1 ] ] ] ] % 32; // Calculate the contribution from the five corners

			let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0 - w0 * w0;
			if ( t0 < 0 ) n0 = 0.0; else {

				t0 *= t0;
				n0 = t0 * t0 * this.dot4( grad4[ gi0 ], x0, y0, z0, w0 );

			}

			let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1 - w1 * w1;
			if ( t1 < 0 ) n1 = 0.0; else {

				t1 *= t1;
				n1 = t1 * t1 * this.dot4( grad4[ gi1 ], x1, y1, z1, w1 );

			}

			let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2 - w2 * w2;
			if ( t2 < 0 ) n2 = 0.0; else {

				t2 *= t2;
				n2 = t2 * t2 * this.dot4( grad4[ gi2 ], x2, y2, z2, w2 );

			}

			let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3 - w3 * w3;
			if ( t3 < 0 ) n3 = 0.0; else {

				t3 *= t3;
				n3 = t3 * t3 * this.dot4( grad4[ gi3 ], x3, y3, z3, w3 );

			}

			let t4 = 0.6 - x4 * x4 - y4 * y4 - z4 * z4 - w4 * w4;
			if ( t4 < 0 ) n4 = 0.0; else {

				t4 *= t4;
				n4 = t4 * t4 * this.dot4( grad4[ gi4 ], x4, y4, z4, w4 );

			} // Sum up and scale the result to cover the range [-1,1]

			return 27.0 * ( n0 + n1 + n2 + n3 + n4 );

		}

	}

	THREE.SimplexNoise = SimplexNoise;

} )();

/* ---- shaders/SSAOShader.js ---- */
( function () {

	/**
 * References:
 * http://john-chapman-graphics.blogspot.com/2013/01/ssao-tutorial.html
 * https://learnopengl.com/Advanced-Lighting/SSAO
 * https://github.com/McNopper/OpenGL/blob/master/Example28/shader/ssao.frag.glsl
 */

	const SSAOShader = {
		defines: {
			'PERSPECTIVE_CAMERA': 1,
			'KERNEL_SIZE': 32
		},
		uniforms: {
			'tDiffuse': {
				value: null
			},
			'tNormal': {
				value: null
			},
			'tDepth': {
				value: null
			},
			'tNoise': {
				value: null
			},
			'kernel': {
				value: null
			},
			'cameraNear': {
				value: null
			},
			'cameraFar': {
				value: null
			},
			'resolution': {
				value: new THREE.Vector2()
			},
			'cameraProjectionMatrix': {
				value: new THREE.Matrix4()
			},
			'cameraInverseProjectionMatrix': {
				value: new THREE.Matrix4()
			},
			'kernelRadius': {
				value: 8
			},
			'minDistance': {
				value: 0.005
			},
			'maxDistance': {
				value: 0.05
			}
		},
		vertexShader:
  /* glsl */
  `

		varying vec2 vUv;

		void main() {

			vUv = uv;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
		fragmentShader:
  /* glsl */
  `

		uniform sampler2D tDiffuse;
		uniform sampler2D tNormal;
		uniform sampler2D tDepth;
		uniform sampler2D tNoise;

		uniform vec3 kernel[ KERNEL_SIZE ];

		uniform vec2 resolution;

		uniform float cameraNear;
		uniform float cameraFar;
		uniform mat4 cameraProjectionMatrix;
		uniform mat4 cameraInverseProjectionMatrix;

		uniform float kernelRadius;
		uniform float minDistance; // avoid artifacts caused by neighbour fragments with minimal depth difference
		uniform float maxDistance; // avoid the influence of fragments which are too far away

		varying vec2 vUv;

		#include <packing>

		float getDepth( const in vec2 screenPosition ) {

			return texture2D( tDepth, screenPosition ).x;

		}

		float getLinearDepth( const in vec2 screenPosition ) {

			#if PERSPECTIVE_CAMERA == 1

				float fragCoordZ = texture2D( tDepth, screenPosition ).x;
				float viewZ = perspectiveDepthToViewZ( fragCoordZ, cameraNear, cameraFar );
				return viewZToOrthographicDepth( viewZ, cameraNear, cameraFar );

			#else

				return texture2D( tDepth, screenPosition ).x;

			#endif

		}

		float getViewZ( const in float depth ) {

			#if PERSPECTIVE_CAMERA == 1

				return perspectiveDepthToViewZ( depth, cameraNear, cameraFar );

			#else

				return orthographicDepthToViewZ( depth, cameraNear, cameraFar );

			#endif

		}

		vec3 getViewPosition( const in vec2 screenPosition, const in float depth, const in float viewZ ) {

			float clipW = cameraProjectionMatrix[2][3] * viewZ + cameraProjectionMatrix[3][3];

			vec4 clipPosition = vec4( ( vec3( screenPosition, depth ) - 0.5 ) * 2.0, 1.0 );

			clipPosition *= clipW; // unprojection.

			return ( cameraInverseProjectionMatrix * clipPosition ).xyz;

		}

		vec3 getViewNormal( const in vec2 screenPosition ) {

			return unpackRGBToNormal( texture2D( tNormal, screenPosition ).xyz );

		}

		void main() {

			float depth = getDepth( vUv );
			float viewZ = getViewZ( depth );

			vec3 viewPosition = getViewPosition( vUv, depth, viewZ );
			vec3 viewNormal = getViewNormal( vUv );

			vec2 noiseScale = vec2( resolution.x / 4.0, resolution.y / 4.0 );
			vec3 random = texture2D( tNoise, vUv * noiseScale ).xyz;

			// compute matrix used to reorient a kernel vector

			vec3 tangent = normalize( random - viewNormal * dot( random, viewNormal ) );
			vec3 bitangent = cross( viewNormal, tangent );
			mat3 kernelMatrix = mat3( tangent, bitangent, viewNormal );

		 float occlusion = 0.0;

		 for ( int i = 0; i < KERNEL_SIZE; i ++ ) {

				vec3 sampleVector = kernelMatrix * kernel[ i ]; // reorient sample vector in view space
				vec3 samplePoint = viewPosition + ( sampleVector * kernelRadius ); // calculate sample point

				vec4 samplePointNDC = cameraProjectionMatrix * vec4( samplePoint, 1.0 ); // project point and calculate NDC
				samplePointNDC /= samplePointNDC.w;

				vec2 samplePointUv = samplePointNDC.xy * 0.5 + 0.5; // compute uv coordinates

				float realDepth = getLinearDepth( samplePointUv ); // get linear depth from depth texture
				float sampleDepth = viewZToOrthographicDepth( samplePoint.z, cameraNear, cameraFar ); // compute linear depth of the sample view Z value
				float delta = sampleDepth - realDepth;

				if ( delta > minDistance && delta < maxDistance ) { // if fragment is before sample point, increase occlusion

					occlusion += 1.0;

				}

			}

			occlusion = clamp( occlusion / float( KERNEL_SIZE ), 0.0, 1.0 );

			gl_FragColor = vec4( vec3( 1.0 - occlusion ), 1.0 );

		}`
	};
	const SSAODepthShader = {
		defines: {
			'PERSPECTIVE_CAMERA': 1
		},
		uniforms: {
			'tDepth': {
				value: null
			},
			'cameraNear': {
				value: null
			},
			'cameraFar': {
				value: null
			}
		},
		vertexShader: `varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
		fragmentShader: `uniform sampler2D tDepth;

		uniform float cameraNear;
		uniform float cameraFar;

		varying vec2 vUv;

		#include <packing>

		float getLinearDepth( const in vec2 screenPosition ) {

			#if PERSPECTIVE_CAMERA == 1

				float fragCoordZ = texture2D( tDepth, screenPosition ).x;
				float viewZ = perspectiveDepthToViewZ( fragCoordZ, cameraNear, cameraFar );
				return viewZToOrthographicDepth( viewZ, cameraNear, cameraFar );

			#else

				return texture2D( tDepth, screenPosition ).x;

			#endif

		}

		void main() {

			float depth = getLinearDepth( vUv );
			gl_FragColor = vec4( vec3( 1.0 - depth ), 1.0 );

		}`
	};
	const SSAOBlurShader = {
		uniforms: {
			'tDiffuse': {
				value: null
			},
			'resolution': {
				value: new THREE.Vector2()
			}
		},
		vertexShader: `varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
		fragmentShader: `uniform sampler2D tDiffuse;

		uniform vec2 resolution;

		varying vec2 vUv;

		void main() {

			vec2 texelSize = ( 1.0 / resolution );
			float result = 0.0;

			for ( int i = - 2; i <= 2; i ++ ) {

				for ( int j = - 2; j <= 2; j ++ ) {

					vec2 offset = ( vec2( float( i ), float( j ) ) ) * texelSize;
					result += texture2D( tDiffuse, vUv + offset ).r;

				}

			}

			gl_FragColor = vec4( vec3( result / ( 5.0 * 5.0 ) ), 1.0 );

		}`
	};

	THREE.SSAOBlurShader = SSAOBlurShader;
	THREE.SSAODepthShader = SSAODepthShader;
	THREE.SSAOShader = SSAOShader;

} )();

/* ---- postprocessing/EffectComposer.js ---- */
( function () {

	class EffectComposer {

		constructor( renderer, renderTarget ) {

			this.renderer = renderer;

			if ( renderTarget === undefined ) {

				const parameters = {
					minFilter: THREE.LinearFilter,
					magFilter: THREE.LinearFilter,
					format: THREE.RGBAFormat
				};
				const size = renderer.getSize( new THREE.Vector2() );
				this._pixelRatio = renderer.getPixelRatio();
				this._width = size.width;
				this._height = size.height;
				renderTarget = new THREE.WebGLRenderTarget( this._width * this._pixelRatio, this._height * this._pixelRatio, parameters );
				renderTarget.texture.name = 'EffectComposer.rt1';

			} else {

				this._pixelRatio = 1;
				this._width = renderTarget.width;
				this._height = renderTarget.height;

			}

			this.renderTarget1 = renderTarget;
			this.renderTarget2 = renderTarget.clone();
			this.renderTarget2.texture.name = 'EffectComposer.rt2';
			this.writeBuffer = this.renderTarget1;
			this.readBuffer = this.renderTarget2;
			this.renderToScreen = true;
			this.passes = []; // dependencies

			if ( THREE.CopyShader === undefined ) {

				console.error( 'THREE.EffectComposer relies on THREE.CopyShader' );

			}

			if ( THREE.ShaderPass === undefined ) {

				console.error( 'THREE.EffectComposer relies on THREE.ShaderPass' );

			}

			this.copyPass = new THREE.ShaderPass( THREE.CopyShader );
			this.clock = new THREE.Clock();

		}

		swapBuffers() {

			const tmp = this.readBuffer;
			this.readBuffer = this.writeBuffer;
			this.writeBuffer = tmp;

		}

		addPass( pass ) {

			this.passes.push( pass );
			pass.setSize( this._width * this._pixelRatio, this._height * this._pixelRatio );

		}

		insertPass( pass, index ) {

			this.passes.splice( index, 0, pass );
			pass.setSize( this._width * this._pixelRatio, this._height * this._pixelRatio );

		}

		removePass( pass ) {

			const index = this.passes.indexOf( pass );

			if ( index !== - 1 ) {

				this.passes.splice( index, 1 );

			}

		}

		isLastEnabledPass( passIndex ) {

			for ( let i = passIndex + 1; i < this.passes.length; i ++ ) {

				if ( this.passes[ i ].enabled ) {

					return false;

				}

			}

			return true;

		}

		render( deltaTime ) {

			// deltaTime value is in seconds
			if ( deltaTime === undefined ) {

				deltaTime = this.clock.getDelta();

			}

			const currentRenderTarget = this.renderer.getRenderTarget();
			let maskActive = false;

			for ( let i = 0, il = this.passes.length; i < il; i ++ ) {

				const pass = this.passes[ i ];
				if ( pass.enabled === false ) continue;
				pass.renderToScreen = this.renderToScreen && this.isLastEnabledPass( i );
				pass.render( this.renderer, this.writeBuffer, this.readBuffer, deltaTime, maskActive );

				if ( pass.needsSwap ) {

					if ( maskActive ) {

						const context = this.renderer.getContext();
						const stencil = this.renderer.state.buffers.stencil; //context.stencilFunc( context.NOTEQUAL, 1, 0xffffffff );

						stencil.setFunc( context.NOTEQUAL, 1, 0xffffffff );
						this.copyPass.render( this.renderer, this.writeBuffer, this.readBuffer, deltaTime ); //context.stencilFunc( context.EQUAL, 1, 0xffffffff );

						stencil.setFunc( context.EQUAL, 1, 0xffffffff );

					}

					this.swapBuffers();

				}

				if ( THREE.MaskPass !== undefined ) {

					if ( pass instanceof THREE.MaskPass ) {

						maskActive = true;

					} else if ( pass instanceof THREE.ClearMaskPass ) {

						maskActive = false;

					}

				}

			}

			this.renderer.setRenderTarget( currentRenderTarget );

		}

		reset( renderTarget ) {

			if ( renderTarget === undefined ) {

				const size = this.renderer.getSize( new THREE.Vector2() );
				this._pixelRatio = this.renderer.getPixelRatio();
				this._width = size.width;
				this._height = size.height;
				renderTarget = this.renderTarget1.clone();
				renderTarget.setSize( this._width * this._pixelRatio, this._height * this._pixelRatio );

			}

			this.renderTarget1.dispose();
			this.renderTarget2.dispose();
			this.renderTarget1 = renderTarget;
			this.renderTarget2 = renderTarget.clone();
			this.writeBuffer = this.renderTarget1;
			this.readBuffer = this.renderTarget2;

		}

		setSize( width, height ) {

			this._width = width;
			this._height = height;
			const effectiveWidth = this._width * this._pixelRatio;
			const effectiveHeight = this._height * this._pixelRatio;
			this.renderTarget1.setSize( effectiveWidth, effectiveHeight );
			this.renderTarget2.setSize( effectiveWidth, effectiveHeight );

			for ( let i = 0; i < this.passes.length; i ++ ) {

				this.passes[ i ].setSize( effectiveWidth, effectiveHeight );

			}

		}

		setPixelRatio( pixelRatio ) {

			this._pixelRatio = pixelRatio;
			this.setSize( this._width, this._height );

		}

	}

	class Pass {

		constructor() {

			// if set to true, the pass is processed by the composer
			this.enabled = true; // if set to true, the pass indicates to swap read and write buffer after rendering

			this.needsSwap = true; // if set to true, the pass clears its buffer before rendering

			this.clear = false; // if set to true, the result of the pass is rendered to screen. This is set automatically by EffectComposer.

			this.renderToScreen = false;

		}

		setSize( ) {}

		render( ) {

			console.error( 'THREE.Pass: .render() must be implemented in derived pass.' );

		}

	} // Helper for passes that need to fill the viewport with a single quad.


	const _camera = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 ); // https://github.com/mrdoob/three.js/pull/21358


	const _geometry = new THREE.BufferGeometry();

	_geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ - 1, 3, 0, - 1, - 1, 0, 3, - 1, 0 ], 3 ) );

	_geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( [ 0, 2, 0, 0, 2, 0 ], 2 ) );

	class FullScreenQuad {

		constructor( material ) {

			this._mesh = new THREE.Mesh( _geometry, material );

		}

		dispose() {

			this._mesh.geometry.dispose();

		}

		render( renderer ) {

			renderer.render( this._mesh, _camera );

		}

		get material() {

			return this._mesh.material;

		}

		set material( value ) {

			this._mesh.material = value;

		}

	}

	THREE.EffectComposer = EffectComposer;
	THREE.FullScreenQuad = FullScreenQuad;
	THREE.Pass = Pass;

} )();

/* ---- postprocessing/ShaderPass.js ---- */
( function () {

	class ShaderPass extends THREE.Pass {

		constructor( shader, textureID ) {

			super();
			this.textureID = textureID !== undefined ? textureID : 'tDiffuse';

			if ( shader instanceof THREE.ShaderMaterial ) {

				this.uniforms = shader.uniforms;
				this.material = shader;

			} else if ( shader ) {

				this.uniforms = THREE.UniformsUtils.clone( shader.uniforms );
				this.material = new THREE.ShaderMaterial( {
					defines: Object.assign( {}, shader.defines ),
					uniforms: this.uniforms,
					vertexShader: shader.vertexShader,
					fragmentShader: shader.fragmentShader
				} );

			}

			this.fsQuad = new THREE.FullScreenQuad( this.material );

		}

		render( renderer, writeBuffer, readBuffer
			/*, deltaTime, maskActive */
		) {

			if ( this.uniforms[ this.textureID ] ) {

				this.uniforms[ this.textureID ].value = readBuffer.texture;

			}

			this.fsQuad.material = this.material;

			if ( this.renderToScreen ) {

				renderer.setRenderTarget( null );
				this.fsQuad.render( renderer );

			} else {

				renderer.setRenderTarget( writeBuffer ); // TODO: Avoid using autoClear properties, see https://github.com/mrdoob/three.js/pull/15571#issuecomment-465669600

				if ( this.clear ) renderer.clear( renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil );
				this.fsQuad.render( renderer );

			}

		}

	}

	THREE.ShaderPass = ShaderPass;

} )();

/* ---- postprocessing/SSAOPass.js ---- */
( function () {

	class SSAOPass extends THREE.Pass {

		constructor( scene, camera, width, height ) {

			super();
			this.width = width !== undefined ? width : 512;
			this.height = height !== undefined ? height : 512;
			this.clear = true;
			this.camera = camera;
			this.scene = scene;
			this.kernelRadius = 8;
			this.kernelSize = 32;
			this.kernel = [];
			this.noiseTexture = null;
			this.output = 0;
			this.minDistance = 0.005;
			this.maxDistance = 0.1;
			this._visibilityCache = new Map(); //

			this.generateSampleKernel();
			this.generateRandomKernelRotations(); // beauty render target

			const depthTexture = new THREE.DepthTexture();
			depthTexture.type = THREE.UnsignedShortType;
			this.beautyRenderTarget = new THREE.WebGLRenderTarget( this.width, this.height, {
				minFilter: THREE.LinearFilter,
				magFilter: THREE.LinearFilter,
				format: THREE.RGBAFormat
			} ); // normal render target with depth buffer

			this.normalRenderTarget = new THREE.WebGLRenderTarget( this.width, this.height, {
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				format: THREE.RGBAFormat,
				depthTexture: depthTexture
			} ); // ssao render target

			this.ssaoRenderTarget = new THREE.WebGLRenderTarget( this.width, this.height, {
				minFilter: THREE.LinearFilter,
				magFilter: THREE.LinearFilter,
				format: THREE.RGBAFormat
			} );
			this.blurRenderTarget = this.ssaoRenderTarget.clone(); // ssao material

			if ( THREE.SSAOShader === undefined ) {

				console.error( 'THREE.SSAOPass: The pass relies on THREE.SSAOShader.' );

			}

			this.ssaoMaterial = new THREE.ShaderMaterial( {
				defines: Object.assign( {}, THREE.SSAOShader.defines ),
				uniforms: THREE.UniformsUtils.clone( THREE.SSAOShader.uniforms ),
				vertexShader: THREE.SSAOShader.vertexShader,
				fragmentShader: THREE.SSAOShader.fragmentShader,
				blending: THREE.NoBlending
			} );
			this.ssaoMaterial.uniforms[ 'tDiffuse' ].value = this.beautyRenderTarget.texture;
			this.ssaoMaterial.uniforms[ 'tNormal' ].value = this.normalRenderTarget.texture;
			this.ssaoMaterial.uniforms[ 'tDepth' ].value = this.normalRenderTarget.depthTexture;
			this.ssaoMaterial.uniforms[ 'tNoise' ].value = this.noiseTexture;
			this.ssaoMaterial.uniforms[ 'kernel' ].value = this.kernel;
			this.ssaoMaterial.uniforms[ 'cameraNear' ].value = this.camera.near;
			this.ssaoMaterial.uniforms[ 'cameraFar' ].value = this.camera.far;
			this.ssaoMaterial.uniforms[ 'resolution' ].value.set( this.width, this.height );
			this.ssaoMaterial.uniforms[ 'cameraProjectionMatrix' ].value.copy( this.camera.projectionMatrix );
			this.ssaoMaterial.uniforms[ 'cameraInverseProjectionMatrix' ].value.copy( this.camera.projectionMatrixInverse ); // normal material

			this.normalMaterial = new THREE.MeshNormalMaterial();
			this.normalMaterial.blending = THREE.NoBlending; // blur material

			this.blurMaterial = new THREE.ShaderMaterial( {
				defines: Object.assign( {}, THREE.SSAOBlurShader.defines ),
				uniforms: THREE.UniformsUtils.clone( THREE.SSAOBlurShader.uniforms ),
				vertexShader: THREE.SSAOBlurShader.vertexShader,
				fragmentShader: THREE.SSAOBlurShader.fragmentShader
			} );
			this.blurMaterial.uniforms[ 'tDiffuse' ].value = this.ssaoRenderTarget.texture;
			this.blurMaterial.uniforms[ 'resolution' ].value.set( this.width, this.height ); // material for rendering the depth

			this.depthRenderMaterial = new THREE.ShaderMaterial( {
				defines: Object.assign( {}, THREE.SSAODepthShader.defines ),
				uniforms: THREE.UniformsUtils.clone( THREE.SSAODepthShader.uniforms ),
				vertexShader: THREE.SSAODepthShader.vertexShader,
				fragmentShader: THREE.SSAODepthShader.fragmentShader,
				blending: THREE.NoBlending
			} );
			this.depthRenderMaterial.uniforms[ 'tDepth' ].value = this.normalRenderTarget.depthTexture;
			this.depthRenderMaterial.uniforms[ 'cameraNear' ].value = this.camera.near;
			this.depthRenderMaterial.uniforms[ 'cameraFar' ].value = this.camera.far; // material for rendering the content of a render target

			this.copyMaterial = new THREE.ShaderMaterial( {
				uniforms: THREE.UniformsUtils.clone( THREE.CopyShader.uniforms ),
				vertexShader: THREE.CopyShader.vertexShader,
				fragmentShader: THREE.CopyShader.fragmentShader,
				transparent: true,
				depthTest: false,
				depthWrite: false,
				blendSrc: THREE.DstColorFactor,
				blendDst: THREE.ZeroFactor,
				blendEquation: THREE.AddEquation,
				blendSrcAlpha: THREE.DstAlphaFactor,
				blendDstAlpha: THREE.ZeroFactor,
				blendEquationAlpha: THREE.AddEquation
			} );
			this.fsQuad = new THREE.FullScreenQuad( null );
			this.originalClearColor = new THREE.Color();

		}

		dispose() {

			// dispose render targets
			this.beautyRenderTarget.dispose();
			this.normalRenderTarget.dispose();
			this.ssaoRenderTarget.dispose();
			this.blurRenderTarget.dispose(); // dispose materials

			this.normalMaterial.dispose();
			this.blurMaterial.dispose();
			this.copyMaterial.dispose();
			this.depthRenderMaterial.dispose(); // dipsose full screen quad

			this.fsQuad.dispose();

		}

		render( renderer, writeBuffer
			/*, readBuffer, deltaTime, maskActive */
		) {

			// render beauty
			renderer.setRenderTarget( this.beautyRenderTarget );
			renderer.clear();
			renderer.render( this.scene, this.camera ); // render normals and depth (honor only meshes, points and lines do not contribute to SSAO)

			this.overrideVisibility();
			this.renderOverride( renderer, this.normalMaterial, this.normalRenderTarget, 0x7777ff, 1.0 );
			this.restoreVisibility(); // render SSAO

			this.ssaoMaterial.uniforms[ 'kernelRadius' ].value = this.kernelRadius;
			this.ssaoMaterial.uniforms[ 'minDistance' ].value = this.minDistance;
			this.ssaoMaterial.uniforms[ 'maxDistance' ].value = this.maxDistance;
			this.renderPass( renderer, this.ssaoMaterial, this.ssaoRenderTarget ); // render blur

			this.renderPass( renderer, this.blurMaterial, this.blurRenderTarget ); // output result to screen

			switch ( this.output ) {

				case SSAOPass.OUTPUT.SSAO:
					this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.ssaoRenderTarget.texture;
					this.copyMaterial.blending = THREE.NoBlending;
					this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );
					break;

				case SSAOPass.OUTPUT.Blur:
					this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.blurRenderTarget.texture;
					this.copyMaterial.blending = THREE.NoBlending;
					this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );
					break;

				case SSAOPass.OUTPUT.Beauty:
					this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.beautyRenderTarget.texture;
					this.copyMaterial.blending = THREE.NoBlending;
					this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );
					break;

				case SSAOPass.OUTPUT.Depth:
					this.renderPass( renderer, this.depthRenderMaterial, this.renderToScreen ? null : writeBuffer );
					break;

				case SSAOPass.OUTPUT.Normal:
					this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.normalRenderTarget.texture;
					this.copyMaterial.blending = THREE.NoBlending;
					this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );
					break;

				case SSAOPass.OUTPUT.Default:
					this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.beautyRenderTarget.texture;
					this.copyMaterial.blending = THREE.NoBlending;
					this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );
					this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.blurRenderTarget.texture;
					this.copyMaterial.blending = THREE.CustomBlending;
					this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );
					break;

				default:
					console.warn( 'THREE.SSAOPass: Unknown output type.' );

			}

		}

		renderPass( renderer, passMaterial, renderTarget, clearColor, clearAlpha ) {

			// save original state
			renderer.getClearColor( this.originalClearColor );
			const originalClearAlpha = renderer.getClearAlpha();
			const originalAutoClear = renderer.autoClear;
			renderer.setRenderTarget( renderTarget ); // setup pass state

			renderer.autoClear = false;

			if ( clearColor !== undefined && clearColor !== null ) {

				renderer.setClearColor( clearColor );
				renderer.setClearAlpha( clearAlpha || 0.0 );
				renderer.clear();

			}

			this.fsQuad.material = passMaterial;
			this.fsQuad.render( renderer ); // restore original state

			renderer.autoClear = originalAutoClear;
			renderer.setClearColor( this.originalClearColor );
			renderer.setClearAlpha( originalClearAlpha );

		}

		renderOverride( renderer, overrideMaterial, renderTarget, clearColor, clearAlpha ) {

			renderer.getClearColor( this.originalClearColor );
			const originalClearAlpha = renderer.getClearAlpha();
			const originalAutoClear = renderer.autoClear;
			renderer.setRenderTarget( renderTarget );
			renderer.autoClear = false;
			clearColor = overrideMaterial.clearColor || clearColor;
			clearAlpha = overrideMaterial.clearAlpha || clearAlpha;

			if ( clearColor !== undefined && clearColor !== null ) {

				renderer.setClearColor( clearColor );
				renderer.setClearAlpha( clearAlpha || 0.0 );
				renderer.clear();

			}

			this.scene.overrideMaterial = overrideMaterial;
			renderer.render( this.scene, this.camera );
			this.scene.overrideMaterial = null; // restore original state

			renderer.autoClear = originalAutoClear;
			renderer.setClearColor( this.originalClearColor );
			renderer.setClearAlpha( originalClearAlpha );

		}

		setSize( width, height ) {

			this.width = width;
			this.height = height;
			this.beautyRenderTarget.setSize( width, height );
			this.ssaoRenderTarget.setSize( width, height );
			this.normalRenderTarget.setSize( width, height );
			this.blurRenderTarget.setSize( width, height );
			this.ssaoMaterial.uniforms[ 'resolution' ].value.set( width, height );
			this.ssaoMaterial.uniforms[ 'cameraProjectionMatrix' ].value.copy( this.camera.projectionMatrix );
			this.ssaoMaterial.uniforms[ 'cameraInverseProjectionMatrix' ].value.copy( this.camera.projectionMatrixInverse );
			this.blurMaterial.uniforms[ 'resolution' ].value.set( width, height );

		}

		generateSampleKernel() {

			const kernelSize = this.kernelSize;
			const kernel = this.kernel;

			for ( let i = 0; i < kernelSize; i ++ ) {

				const sample = new THREE.Vector3();
				sample.x = Math.random() * 2 - 1;
				sample.y = Math.random() * 2 - 1;
				sample.z = Math.random();
				sample.normalize();
				let scale = i / kernelSize;
				scale = THREE.MathUtils.lerp( 0.1, 1, scale * scale );
				sample.multiplyScalar( scale );
				kernel.push( sample );

			}

		}

		generateRandomKernelRotations() {

			const width = 4,
				height = 4;

			if ( THREE.SimplexNoise === undefined ) {

				console.error( 'THREE.SSAOPass: The pass relies on THREE.SimplexNoise.' );

			}

			const simplex = new THREE.SimplexNoise();
			const size = width * height;
			const data = new Float32Array( size * 4 );

			for ( let i = 0; i < size; i ++ ) {

				const stride = i * 4;
				const x = Math.random() * 2 - 1;
				const y = Math.random() * 2 - 1;
				const z = 0;
				const noise = simplex.noise3d( x, y, z );
				data[ stride ] = noise;
				data[ stride + 1 ] = noise;
				data[ stride + 2 ] = noise;
				data[ stride + 3 ] = 1;

			}

			this.noiseTexture = new THREE.DataTexture( data, width, height, THREE.RGBAFormat, THREE.FloatType );
			this.noiseTexture.wrapS = THREE.RepeatWrapping;
			this.noiseTexture.wrapT = THREE.RepeatWrapping;

		}

		overrideVisibility() {

			const scene = this.scene;
			const cache = this._visibilityCache;
			scene.traverse( function ( object ) {

				cache.set( object, object.visible );
				if ( object.isPoints || object.isLine ) object.visible = false;

			} );

		}

		restoreVisibility() {

			const scene = this.scene;
			const cache = this._visibilityCache;
			scene.traverse( function ( object ) {

				const visible = cache.get( object );
				object.visible = visible;

			} );
			cache.clear();

		}

	}

	SSAOPass.OUTPUT = {
		'Default': 0,
		'SSAO': 1,
		'Blur': 2,
		'Beauty': 3,
		'Depth': 4,
		'Normal': 5
	};

	THREE.SSAOPass = SSAOPass;

} )();

